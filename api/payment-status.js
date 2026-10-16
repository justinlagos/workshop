import {db,rpc,seats,mail,notifyAdmin,stripe} from './_shared.js';
import {paymentConfirmation} from '../lib/emails.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false});
 const ref=String(req.query.ref||'');
 if(!/^TBS-[A-Z0-9-]{5,30}$/.test(ref))return res.status(400).json({ok:false,error:'Invalid reference'});
 try{
  const list=await db('workshop_applications?reference=eq.'+encodeURIComponent(ref)+'&select=*');
  const a=list[0];if(!a)return res.status(404).json({ok:false,error:'Booking not found'});
  if(a.status==='paid')return res.status(200).json({ok:true,status:'confirmed'});
  if(!a.stripe_session_id)return res.status(200).json({ok:true,status:'pending'});
  const client=stripe();if(!client||!process.env.STRIPE_WEBHOOK_SECRET)return res.status(200).json({ok:true,status:'pending'});
  const session=await client.checkout.sessions.retrieve(a.stripe_session_id);
  if(session.payment_status!=='paid'||session.status!=='complete')return res.status(200).json({ok:true,status:'pending'});
  const eventKey='verified-'+session.id;
  const outcome=await rpc('workshop_confirm_payment',{p_event:eventKey,p_session:session.id,p_reference:a.reference,p_currency:session.currency,p_amount:session.amount_total});
  if(outcome==='confirmed'){
   const d={fullName:a.full_name,email:a.email,currency:a.currency,projectGoal:a.project_goal};
   const result={classification:a.classification,score:a.score};
   try{await mail(a.email,paymentConfirmation(d,a.reference,result,session.id));}catch(e){console.error('payment email delivery failed',e.message)}
   try{await notifyAdmin(a,'Verified payment received',await seats());}catch(e){console.error('admin payment email failed',e.message)}
  }
  if(['confirmed','already-paid','duplicate-event'].includes(outcome))return res.status(200).json({ok:true,status:'confirmed'});
  if(outcome==='full-refund-required')return res.status(200).json({ok:true,status:'support',message:'Payment needs manual reconciliation'});
  return res.status(200).json({ok:true,status:'pending'});
 }catch(e){console.error('Payment status verification failed',e.message);return res.status(503).json({ok:false,status:'pending'});}
}
