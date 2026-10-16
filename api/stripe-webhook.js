import {db,rpc,seats,mail,notifyAdmin,stripe,method} from './_shared.js';
export const config={api:{bodyParser:false}};
async function raw(req){const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
export default async function handler(req,res){
 if(!method(req,res,'POST'))return;
 const client=stripe();
 if(!client||!process.env.STRIPE_WEBHOOK_SECRET)return res.status(503).json({ok:false,error:'Payment verification not configured'});
 let event;
 try{event=client.webhooks.constructEvent(await raw(req),req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}
 catch{return res.status(400).json({ok:false,error:'Invalid payment signature'});}
 if(event.type!=='checkout.session.completed')return res.status(200).json({received:true});
 const session=event.data.object,reference=session.metadata?.reference;
 if(!reference)return res.status(200).json({received:true,unmatched:true});
 if(session.payment_status!=='paid')return res.status(200).json({received:true,pending:true});
 try{
  const outcome=await rpc('workshop_confirm_payment',{p_event:event.id,p_session:session.id,p_reference:reference,p_currency:session.currency,p_amount:session.amount_total});
  if(outcome==='confirmed'){
   const entries=await db('workshop_applications?reference=eq.'+encodeURIComponent(reference)+'&select=*');
   const a=entries[0],s=await seats();
   if(a){
    const info=['Your Build Session seat is confirmed.','Date: Saturday 24 October 2026','Time: 2 PM–5 PM UK','Reference: '+a.reference,'Your project: '+a.project_goal,'We will send your joining instructions before the workshop.'];
    try{await mail(a.email,{subject:'Your seat is confirmed | The Build Session',text:'Hi '+a.full_name.split(' ')[0]+',\n\n'+info.join('\n'),html:'<div style="font-family:Arial;line-height:1.7;max-width:580px"><h2>You’re in. Your seat is confirmed.</h2><p>Hi '+a.full_name.split(' ')[0].replace(/&/g,'&amp;').replace(/</g,'&lt;')+',</p><p>'+info.map(x=>x.replace(/&/g,'&amp;').replace(/</g,'&lt;')).join('<br>')+'</p><p>MotionPlay Labs</p></div>'});}catch(e){console.error('Confirmation email failed:',e.message);}
    try{await notifyAdmin(a,'Verified payment received',s);}catch(e){console.error('Admin notification failed:',e.message);}
   }
  }else if(outcome==='full-refund-required'||outcome==='verification-mismatch'){
   console.error('PAYMENT REQUIRES ADMIN RECONCILIATION',outcome,reference);
  }
  return res.status(200).json({received:true,outcome});
 }catch(e){console.error('Webhook storage failure:',e.message);return res.status(500).json({ok:false,error:'Payment reconciliation failed; Stripe will retry'});}
}
