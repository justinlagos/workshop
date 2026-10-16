import {db,seats,stripe,site,mail,notifyAdmin,configured,method,classify,feeFor,applicationResult,reviewRequired,futureCohort,applicantAcceptance} from './_shared.js';
const validEmail=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export default async function handler(req,res){
 if(!method(req,res,'POST'))return;
 if(!configured())return res.status(503).json({ok:false,error:'Enrolment setup is not complete'});
 const b=req.body||{};
 if(b.company_website)return res.status(400).json({ok:false,error:'Invalid submission'});
 const fullName=String(b.fullName||'').trim(),email=String(b.email||'').trim().toLowerCase(),country=String(b.country||'').trim(),whatsapp=String(b.whatsapp||'').trim(),experience=String(b.aiExperience||''),claude=String(b.claudePlan||''),goal=String(b.projectGoal||'').trim();
 const currency=country.toLowerCase().includes('nigeria')?'NGN':'GBP';
 if(fullName.length<2||fullName.length>80||!validEmail(email)||!country||!['Beginner','Basic','Intermediate'].includes(experience)||!['Yes','No','Not sure'].includes(claude)||goal.length<10||goal.length>300)return res.status(400).json({ok:false,error:'Please complete all required fields correctly'});
 const result=classify({aiExperience:experience,claudePlan:claude,projectGoal:goal}),reference='TBS-'+crypto.randomUUID().slice(0,10).toUpperCase();
 const row={reference,cohort_id:'cohort-01',full_name:fullName,email,country,whatsapp,ai_experience:experience,claude_plan:claude,project_goal:goal,currency,classification:result.classification,score:result.score,breakdown:result.breakdown,status:result.eligible?'applied':result.classification==='Foundation'?'foundation':'reviewed'};
 let saved;
 try{
  const created=await db('workshop_applications',{method:'POST',prefer:'return=representation',body:row});saved=created[0];
 }catch(e){
  if(e.code==='23505'||e.status===409)return res.status(409).json({ok:false,error:'This email has already applied'});
  return res.status(503).json({ok:false,error:'Application cannot be saved right now'});
 }
 let inviteUrl=null;
 let s;
 try{s=await seats();}catch{s={capacity:8,paid:0,remaining:null};}
 const r=applicationResult(saved);
 try {
  let message;
  if(result.eligible){
   const client=stripe();
   if(client && s.remaining>0){
    const fee=feeFor(currency);
    const checkout=await client.checkout.sessions.create({mode:'payment',customer_email:email,line_items:[{price_data:{currency:fee.currency,unit_amount:fee.amount,product_data:{name:'The Build Session — Founding Cohort 01'}},quantity:1}],client_reference_id:reference,metadata:{reference,cohort:'cohort-01'},expires_at:Math.floor(Date.now()/1000)+1800,success_url:site()+'/payment-success.html?ref='+encodeURIComponent(reference),cancel_url:site()+'/?payment=cancelled'});
    inviteUrl=checkout.url;
    await db('workshop_applications?reference=eq.'+encodeURIComponent(reference),{method:'PATCH',body:{status:'invited',stripe_session_id:checkout.id,invite_url:checkout.url,invite_expires_at:new Date(checkout.expires_at*1000).toISOString()}});
    message=applicantAcceptance({fullName,email,aiExperience:experience,projectGoal:goal,currency,reference},reference,r,checkout.url,site(),{seatsRemaining:s.remaining,expiresAt:new Date(checkout.expires_at*1000).toISOString()});
   }else{
    message=reviewRequired({fullName,email,aiExperience:experience,projectGoal:goal,currency,reference},reference,r,site());
    message.subject='Your Build Session application — received';
   }
  }else if(result.classification==='Foundation')message=futureCohort({fullName,email,aiExperience:experience,projectGoal:goal,reference},reference,r,site());
  else message=reviewRequired({fullName,email,aiExperience:experience,projectGoal:goal,reference},reference,r,site());
  await mail(email,message);
  await notifyAdmin(saved, 'New '+result.classification+' application',s);
 }catch(e){console.error('Application notification or checkout pending:',e.message);}
 return res.status(201).json({ok:true,reference,classification:result.classification,eligible:result.eligible,emailSent:!!process.env.RESEND_API_KEY,invited:!!inviteUrl,seats:s});
}
