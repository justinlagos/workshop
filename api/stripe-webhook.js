import {db,rpc,seats,mail,notifyAdmin,stripe,method} from './_shared.js';
import {prepEmail} from '../lib/prep.js';
import {afterIntakePayment} from '../lib/intake-fulfil.js';
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
 if(session.metadata?.group_reference){
  if(session.payment_status!=='paid')return res.status(200).json({received:true,pending:true});
  try{
   const groupRef=session.metadata.group_reference;
   const outcome=await rpc('workshop_confirm_group_payment',{p_event:event.id,p_session:session.id,p_group_reference:groupRef,p_currency:session.currency,p_amount:session.amount_total});
   if(outcome==='confirmed'){
    const groups=await db('workshop_group_checkouts?session_id=eq.'+encodeURIComponent(session.id)+'&select=*');
    const group=groups[0];
    const applicants=await db('workshop_applications?reference=in.('+group.applicant_references.map(encodeURIComponent).join(',')+')&select=*');
    for(const a of applicants){
     try{
      await mail(a.email,{subject:'Confirmed: your Build Session place · '+a.reference,
       text:'Hi '+a.full_name.split(' ')[0]+',\n\nYour place for The Build Session is confirmed. Payment was made for you by a group sponsor.\nSaturday 24 October 2026, 2–5 PM UK, online.\nBooking reference: '+a.reference+'\nYour joining details and preparation guide will follow.\n\nMotionPlay Labs',
       html:'<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;line-height:1.6"><img width="132" alt="MotionPlay Labs" src="https://d2ol7oe51mr4n9.cloudfront.net/user_3B7NW37kNCO9R3JjEQ3Re2UR4ee/33f6247e-a677-4e37-9ca6-0fad86efc4d4.png"/><h2>Your place is confirmed.</h2><p>Hi '+a.full_name.split(' ')[0].replace(/&/g,'&amp;').replace(/</g,'&lt;')+',</p><p>Your Build Session seat has been secured through a group payment.</p><p><b>Saturday 24 October 2026 · 2–5 PM UK · Online</b><br>Booking reference: '+a.reference+'</p><p>Your joining details and preparation guide will follow.</p><p>MotionPlay Labs</p></div>'});
     }catch(e){console.error('Group attendee mail failed',a.reference,e.message);}
    }
    try{await mail(group.payer_email,{subject:'Payment confirmed · 3 Build Session places',text:'Your payment of NGN 255,000 is confirmed for three Build Session attendees. References: '+group.applicant_references.join(', ')+'. The attendees have been sent individual booking confirmations.',html:'<div style="font-family:Arial,sans-serif"><h2>Three seats confirmed.</h2><p>Payment received: <b>₦255,000</b></p><p>Attendee references: '+group.applicant_references.join(' · ')+'</p><p>Individual confirmations have been sent to the attendees.</p></div>'});}catch(e){console.error('Group payer mail failed',e.message);}
    try{await mail(process.env.ADMIN_EMAIL||'justin@motionplaylabs.com',{subject:'Group payment confirmed · '+groupRef,text:'₦255,000 for three seats. '+group.applicant_references.join(', '),html:'<p>Group payment verified: ₦255,000 for 3 seats.</p><p>'+group.applicant_references.join('<br>')+'</p>'});}catch(e){console.error('Group admin mail failed',e.message);}
   } else if(outcome==='full-refund-required'||outcome==='verification-mismatch'){
    console.error('Group checkout needs reconciliation',groupRef,outcome);
   }
   return res.status(200).json({received:true,outcome});
  }catch(e){console.error('Group payment fulfilment failed',e.message);return res.status(500).json({ok:false,error:'Group payment reconciliation failed'});}
 }

 if(!reference)return res.status(200).json({received:true,unmatched:true});
 if(session.payment_status!=='paid')return res.status(200).json({received:true,pending:true});
 try{
  const outcome=await rpc('workshop_confirm_payment',{p_event:event.id,p_session:session.id,p_reference:reference,p_currency:session.currency,p_amount:session.amount_total});
  // Rolling intake (Cohorts 02 onwards): the database has placed the payer; send the right emails.
  if(session.metadata?.intake){
   const done=await afterIntakePayment(outcome,reference,session);
   return res.status(200).json({received:true,outcome,status:done.status});
  }
  if(outcome==='confirmed'){
   const entries=await db('workshop_applications?reference=eq.'+encodeURIComponent(reference)+'&select=*');
   const a=entries[0],s=await seats();
   if(a){
    // Confirmation doubles as the prep email (Zoom link, checklist, timings) once the cohort has a join link.
    const cohort=(await db('workshop_cohorts?id=eq.'+encodeURIComponent(a.cohort_id||'cohort-01')+'&select=*').catch(()=>[]))[0];
    if(cohort&&cohort.join_url){try{await mail(a.email,prepEmail(a,cohort));}catch(e){console.error('Prep email failed:',e.message);}}
    else{
    const info=['Your Build Session seat is confirmed.','Date: Saturday 24 October 2026','Time: 2 PM–5 PM UK','Reference: '+a.reference,'Your project: '+a.project_goal,'We will send your joining instructions before the workshop.'];
    try{await mail(a.email,{subject:'Your seat is confirmed | The Build Session',text:'Hi '+a.full_name.split(' ')[0]+',\n\n'+info.join('\n'),html:'<div style="font-family:Arial;line-height:1.7;max-width:580px"><img src="https://d2ol7oe51mr4n9.cloudfront.net/user_3B7NW37kNCO9R3JjEQ3Re2UR4ee/33f6247e-a677-4e37-9ca6-0fad86efc4d4.png" alt="MotionPlay Labs" width="132" style="display:block;width:132px;height:auto;margin-bottom:18px"/><h2>You’re in. Your seat is confirmed.</h2><p>Hi '+a.full_name.split(' ')[0].replace(/&/g,'&amp;').replace(/</g,'&lt;')+',</p><p>'+info.map(x=>x.replace(/&/g,'&amp;').replace(/</g,'&lt;')).join('<br>')+'</p><p>MotionPlay Labs</p></div>'});}catch(e){console.error('Confirmation email failed:',e.message);}
    }
    try{await notifyAdmin(a,'Verified payment received',s);}catch(e){console.error('Admin notification failed:',e.message);}
   }
  }else if(outcome==='full-refund-required'||outcome==='verification-mismatch'){
   console.error('PAYMENT REQUIRES ADMIN RECONCILIATION',outcome,reference);
  }
  return res.status(200).json({received:true,outcome});
 }catch(e){console.error('Webhook storage failure:',e.message);return res.status(500).json({ok:false,error:'Payment reconciliation failed; Stripe will retry'});}
}
