import {db,rpc,seats,mail,notifyAdmin,stripe} from './_shared.js';
import {paymentConfirmation} from '../lib/emails.js';
import {prepEmail} from '../lib/prep.js';
import {afterIntakePayment,cohortById,sessionInfo} from '../lib/intake-fulfil.js';
import {sessionDay,sessionTimes} from '../lib/intake.js';

const withDate=(c)=>c?{...sessionInfo(c),date:sessionDay(c.session_at),times:sessionTimes(c.session_at,c.duration_minutes||180)}:null;

export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false});
 const ref=String(req.query.ref||'');
 if(!/^TBS-[A-Z0-9-]{5,30}$/.test(ref))return res.status(400).json({ok:false,error:'Invalid reference'});
 try{
  const list=await db('workshop_applications?reference=eq.'+encodeURIComponent(ref)+'&select=*');
  const a=list[0];if(!a)return res.status(404).json({ok:false,error:'Booking not found'});

  // Rolling intake (Cohorts 02 onwards).
  if(a.intake_id){
   const projected=a.projected_cohort_id?await cohortById(a.projected_cohort_id):null;
   if(a.status==='paid'){
    const c=await cohortById(a.cohort_id);
    return res.status(200).json({ok:true,status:'confirmed',session:withDate(c),moved:!!(projected&&projected.id!==c?.id),projected:withDate(projected)});
   }
   if(a.status==='refunded'||a.status==='refund-required')return res.status(200).json({ok:true,status:'full',refunded:a.status==='refunded'});
   if(!a.stripe_session_id)return res.status(200).json({ok:true,status:'pending',projected:withDate(projected)});
   const client=stripe();if(!client)return res.status(200).json({ok:true,status:'pending',projected:withDate(projected)});
   const session=await client.checkout.sessions.retrieve(a.stripe_session_id);
   if(session.payment_status!=='paid'||session.status!=='complete')return res.status(200).json({ok:true,status:'pending',projected:withDate(projected)});
   const outcome=await rpc('workshop_confirm_payment',{p_event:'verified-'+session.id,p_session:session.id,p_reference:a.reference,p_currency:session.currency,p_amount:session.amount_total});
   const done=await afterIntakePayment(outcome,a.reference,session);
   if(done.status==='confirmed'){
    const c=done.cohort||await cohortById((await db('workshop_applications?reference=eq.'+encodeURIComponent(ref)+'&select=cohort_id'))[0]?.cohort_id);
    return res.status(200).json({ok:true,status:'confirmed',session:withDate(c),moved:!!(projected&&projected.id!==c?.id),projected:withDate(projected)});
   }
   if(done.status==='full')return res.status(200).json({ok:true,status:'full',refunded:!!done.refunded});
   if(done.status==='support')return res.status(200).json({ok:true,status:'support',message:'Payment needs manual reconciliation'});
   return res.status(200).json({ok:true,status:'pending',projected:withDate(projected)});
  }

  // Founding Cohort 01 path, unchanged.
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
   const cohort=(await db('workshop_cohorts?id=eq.'+encodeURIComponent(a.cohort_id||'cohort-01')+'&select=*').catch(()=>[]))[0];
   try{await mail(a.email,cohort&&cohort.join_url?prepEmail(a,cohort):paymentConfirmation(d,a.reference,result,session.id,{amount:session.amount_total}));}catch(e){console.error('payment email delivery failed',e.message)}
   try{await notifyAdmin(a,'Verified payment received',await seats());}catch(e){console.error('admin payment email failed',e.message)}
  }
  if(['confirmed','already-paid','duplicate-event'].includes(outcome))return res.status(200).json({ok:true,status:'confirmed'});
  if(outcome==='full-refund-required')return res.status(200).json({ok:true,status:'support',message:'Payment needs manual reconciliation'});
  return res.status(200).json({ok:true,status:'pending'});
 }catch(e){console.error('Payment status verification failed',e.message);return res.status(503).json({ok:false,status:'pending'});}
}
