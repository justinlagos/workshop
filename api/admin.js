import {db,seats,stripe,site,mail,adminOk,method,feeFor,applicantAcceptance,reviewRequired,futureCohort,applicationResult,notifyAdmin} from './_shared.js';
function err(res,code,message){return res.status(code).json({ok:false,error:message});}
const cleanse=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function display(a){return {reference:a.reference,createdAt:a.created_at,fullName:cleanse(a.full_name),email:cleanse(a.email),country:cleanse(a.country),whatsapp:cleanse(a.whatsapp),aiExperience:cleanse(a.ai_experience),claudePlan:cleanse(a.claude_plan),projectGoal:cleanse(a.project_goal),classification:a.classification,classificationScore:a.score,classificationBreakdown:a.breakdown,status:a.status,currency:a.currency,invite:a.stripe_session_id?{createdAt:a.created_at,expiresAt:a.invite_expires_at,url:a.invite_url}:null,payment:a.paid_at?{paidAt:a.paid_at}:null};}
function model(a){return {fullName:a.full_name,email:a.email,country:a.country,whatsapp:a.whatsapp,aiExperience:a.ai_experience,claudePlan:a.claude_plan,projectGoal:a.project_goal,currency:a.currency,reference:a.reference};}
async function byRef(reference){const rows=await db('workshop_applications?reference=eq.'+encodeURIComponent(reference)+'&select=*');return rows[0];}
async function update(reference,patch){const rows=await db('workshop_applications?reference=eq.'+encodeURIComponent(reference),{method:'PATCH',body:patch,prefer:'return=representation'});return rows[0];}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(!adminOk(req))return err(res,401,'Unauthorised');
 const action=String(req.query.action||'');
 try{
  if(action==='applicants'&&method(req,res,'GET')){
   const rows=await db('workshop_applications?select=*&order=created_at.desc&limit=300');
   return res.status(200).json({ok:true,applicants:rows.map(display),seats:await seats()});
  }
  if(action==='payments'&&method(req,res,'GET')){
   const rows=await db('workshop_payment_events?select=stripe_event_id,stripe_session_id,outcome,recorded_at&order=recorded_at.desc&limit=300');
   return res.status(200).json({ok:true,payments:rows,seats:await seats()});
  }
  if(action==='payments-capability'&&method(req,res,'GET')){
   const client=stripe();if(!client)return err(res,503,'Stripe test key not configured');
   const account=await client.accounts.retrieve();
   return res.status(200).json({ok:true,capability:{accountId:account.id,country:account.country,chargesEnabled:account.charges_enabled,mode:process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')?'test':'live',note:'NGN must pass a real test-mode Checkout before activation'}});
  }
  if(action==='export'&&method(req,res,'GET')){
   const rows=await db('workshop_applications?select=reference,full_name,email,country,whatsapp,ai_experience,claude_plan,project_goal,currency,classification,status,paid_at,created_at&order=created_at.asc&limit=1000');
   const columns=['reference','full_name','email','country','whatsapp','ai_experience','claude_plan','project_goal','currency','classification','status','paid_at','created_at'];
   const csv=[columns.join(','),...rows.map(row=>columns.map(c=>'"'+String(row[c]??'').replace(/"/g,'""').replace(/^[=+@\-]/,'\x27$&')+'"').join(','))].join('\r\n');
   res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="build-session-applicants.csv"');return res.status(200).send(csv);
  }
  if(!method(req,res,'POST'))return;
  const ref=String(req.body?.reference||'');
  if(action==='mark-paid')return err(res,403,'Manual confirmation disabled. Seats are confirmed only through verified Stripe webhooks.');
  if(action==='test-emails'){
   const to=process.env.ADMIN_EMAIL;if(!to)return err(res,503,'Admin email not configured');
   const r=await mail(to,{subject:'The Build Session — transactional email integration test',text:'Your Vercel email integration is configured. This test does not create a booking.',html:'<h2>The Build Session</h2><p>Transactional email integration test. No booking was created.</p>'});
   return res.status(200).json({ok:true,results:[{ok:r.sent,via:r.sent?'resend':'not configured'}]});
  }
  if(!ref)return err(res,400,'Applicant reference required');
  const a=await byRef(ref);if(!a)return err(res,404,'Applicant not found');
  if(action==='review'){
   const decision=String(req.body.decision||'');
   const patch=decision==='accept'?{classification:'Guided Builder',status:'applied'}:decision==='future'?{classification:'Foundation',status:'foundation'}:decision==='review'?{classification:'Review Required',status:'reviewed'}:null;
   if(!patch)return err(res,400,'Invalid decision');
   if(a.status==='paid')return err(res,409,'Cannot reclassify confirmed attendee');
   const updated=await update(ref,patch);
   const result=applicationResult(updated),d=model(updated);
   await mail(updated.email,decision==='future'?futureCohort(d,ref,result,site()):reviewRequired(d,ref,result,site()));
   return res.status(200).json({ok:true,applicant:display(updated)});
  }
  if(action==='invite'){
   if(a.classification!=='Guided Builder'||a.status==='paid'||a.status==='foundation'||a.status==='reviewed')return err(res,403,'Applicant is not eligible for payment invitation');
   const current=await seats();if(!current.remaining)return err(res,409,'The cohort is full');
   if(a.invite_url&&a.invite_expires_at&&new Date(a.invite_expires_at)>new Date())return res.status(200).json({ok:true,url:a.invite_url,reused:true});
   const client=stripe();if(!client)return err(res,503,'Stripe test credentials are not yet configured');
   if(!process.env.STRIPE_SECRET_KEY.startsWith('sk_test_'))return err(res,403,'Live charges disabled until checkout verification and explicit approval');
   const fee=feeFor(a.currency),expires=Math.floor(Date.now()/1000)+1800;
   const session=await client.checkout.sessions.create({mode:'payment',customer_email:a.email,client_reference_id:ref,line_items:[{price_data:{currency:fee.currency,unit_amount:fee.amount,product_data:{name:'The Build Session — Founding Cohort 01'}},quantity:1}],metadata:{reference:ref,cohort:'cohort-01'},expires_at:expires,success_url:site()+'/payment-success.html?ref='+encodeURIComponent(ref),cancel_url:site()+'/?payment=cancelled'});
   const updated=await update(ref,{status:'invited',stripe_session_id:session.id,invite_url:session.url,invite_expires_at:new Date(expires*1000).toISOString()});
   await mail(a.email,applicantAcceptance(model(updated),ref,applicationResult(updated),session.url,site(),{seatsRemaining:current.remaining,expiresAt:updated.invite_expires_at}));
   return res.status(200).json({ok:true,url:session.url,reused:false});
  }
  if(action==='remind'){
   if(a.status!=='invited'||!a.invite_url||new Date(a.invite_expires_at)<new Date())return err(res,400,'No active invitation to remind');
   const message={subject:'Your Build Session invitation is still open',text:'Hi '+a.full_name.split(' ')[0]+', your payment invitation is still available while seats remain. Secure your seat: '+a.invite_url,html:'<p>Hi '+cleanse(a.full_name.split(' ')[0])+',</p><p>Your Build Session invitation is still available, subject to capacity.</p><p><a href="'+a.invite_url+'">Secure your seat</a></p>'};
   await mail(a.email,message);return res.status(200).json({ok:true});
  }
  return err(res,404,'Unknown administrator action');
 }catch(e){console.error('Admin operation failed',e.message);return err(res,503,'Admin operation could not be completed');}
}
