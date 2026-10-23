import {db,seats,stripe,site,mail,adminOk,method,feeFor,applicantAcceptance,reviewRequired,futureCohort,applicationResult,notifyAdmin} from './_shared.js';
function err(res,code,message){return res.status(code).json({ok:false,error:message});}
const cleanse=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function display(a){return {reference:a.reference,createdAt:a.created_at,fullName:cleanse(a.full_name),email:cleanse(a.email),country:cleanse(a.country),whatsapp:cleanse(a.whatsapp),aiExperience:cleanse(a.ai_experience),claudePlan:cleanse(a.claude_plan),projectGoal:cleanse(a.project_goal),classification:a.classification,classificationScore:a.score,classificationBreakdown:a.breakdown,status:a.status,currency:a.currency,invite:a.stripe_session_id?{createdAt:a.created_at,expiresAt:a.invite_expires_at,url:a.invite_url}:null,payment:a.paid_at?{paidAt:a.paid_at}:null};}
function model(a){return {fullName:a.full_name,email:a.email,country:a.country,whatsapp:a.whatsapp,aiExperience:a.ai_experience,claudePlan:a.claude_plan,projectGoal:a.project_goal,currency:a.currency,reference:a.reference};}
async function byRef(reference){const rows=await db('workshop_applications?reference=eq.'+encodeURIComponent(reference)+'&select=*');return rows[0];}
async function update(reference,patch){const rows=await db('workshop_applications?reference=eq.'+encodeURIComponent(reference),{method:'PATCH',body:patch,prefer:'return=representation'});return rows[0];}
function fail(code,message){const e=new Error(message);e.http=code;return e;}
// Payment links last 24 hours (Stripe's maximum), minus a minute of headroom.
const LINK_TTL=86400-60;
// One path for approving and resending: reuse a link with more than an hour left,
// otherwise retire the old link (so only one can ever be paid) and issue a new 24-hour one.
// Always emails the applicant the link.
async function sendPaymentLink(a){
 if(a.status==='paid')throw fail(409,'Already paid');
 const current=await seats();if(!current.remaining)throw fail(409,'The cohort is full');
 const client=stripe();if(!client)throw fail(503,'Stripe is not configured');
 const left=a.invite_expires_at?new Date(a.invite_expires_at).getTime()-Date.now():0;
 const reuse=a.status==='invited'&&a.invite_url&&a.stripe_session_id&&left>3600e3;
 let row=a;
 if(!reuse){
  if(a.stripe_session_id){
   const old=await client.checkout.sessions.retrieve(a.stripe_session_id).catch(()=>null);
   if(old&&(old.payment_status==='paid'||old.status==='complete'))throw fail(409,'This applicant has just paid. Refresh in a minute.');
   if(old&&old.status==='open')await client.checkout.sessions.expire(a.stripe_session_id);
  }
  const fee=feeFor(a.currency),expires=Math.floor(Date.now()/1000)+LINK_TTL,ref=a.reference;
  const session=await client.checkout.sessions.create({mode:'payment',customer_email:a.email,client_reference_id:ref,line_items:[{price_data:{currency:fee.currency,unit_amount:fee.amount,product_data:{name:'The Build Session — Founding Cohort 01'}},quantity:1}],metadata:{reference:ref,cohort:'cohort-01'},expires_at:expires,success_url:site()+'/payment-success.html?ref='+encodeURIComponent(ref),cancel_url:site()+'/?payment=cancelled'});
  row=await update(ref,{classification:'Guided Builder',status:'invited',stripe_session_id:session.id,invite_url:session.url,invite_expires_at:new Date(expires*1000).toISOString()});
 }
 await mail(row.email,applicantAcceptance(model(row),row.reference,applicationResult(row),row.invite_url,site(),{seatsRemaining:current.remaining,expiresAt:row.invite_expires_at}));
 return {url:row.invite_url,expiresAt:row.invite_expires_at,reused:!!reuse,applicant:display(row)};
}
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
  if(action==='sample-invitation'){
   const to='mrjustinukaegbu@gmail.com';
   const logo='https://d2ol7oe51mr4n9.cloudfront.net/user_3B7NW37kNCO9R3JjEQ3Re2UR4ee/33f6247e-a677-4e37-9ca6-0fad86efc4d4.png';
   const html='<div style="margin:0 auto;max-width:540px;font:15px/1.65 Arial,sans-serif;color:#111">'
    +'<div style="padding:18px 25px 8px"><img src="'+logo+'" width="132" height="94" alt="MotionPlay Labs" style="display:block;width:132px;height:94px;object-fit:contain;border:0"/><div style="font-size:10px;font-weight:800;letter-spacing:2px">THE BUILD SESSION / COHORT 01</div></div>'
    +'<div style="padding:8px 25px 26px;border-bottom:1px solid #ddd"><p style="color:#666;font-size:12px">SAMPLE EMAIL · NO PAYMENT REQUIRED</p><h1 style="font-size:28px;letter-spacing:-1px">Your invitation is ready.</h1><p>Hi Justin,</p><p>You’re invited to <b>The Build Session, Founding Cohort 01</b>.</p><p>Saturday 24 October 2026 · 2–5 PM UK · Online</p><p><b>£50 UK / ₦85,000 Nigeria</b></p><p style="background:#ccff00;padding:14px 20px;font-weight:bold;text-align:center">SAMPLE ONLY · PAYMENT BUTTON DISABLED</p><p style="font-size:13px;color:#555">This previews the updated logo and invitation design. No booking has been made and no seat has been reserved.</p></div><div style="padding:16px 25px;color:#777;font-size:12px">Justin Ukaegbu · MotionPlay Labs<br>justin@motionplaylabs.com</div></div>';
   const sent=await mail(to,{subject:'[SAMPLE] The Build Session — your invitation',html,text:'Sample invitation. Hi Justin, you are invited to Founding Cohort 01 on Saturday 24 October 2026, 2–5 PM UK, online. Fee: £50 UK / ₦85,000 Nigeria. No payment or booking is required for this sample.'});
   if(!sent.sent)return err(res,503,'Resend not configured');
   return res.status(200).json({ok:true,sent:true,to});
  }
  if(action==='test-emails'){
   const to=process.env.ADMIN_EMAIL;if(!to)return err(res,503,'Admin email not configured');
   const r=await mail(to,{subject:'The Build Session — transactional email integration test',text:'Your Vercel email integration is configured. This test does not create a booking.',html:'<h2>The Build Session</h2><p>Transactional email integration test. No booking was created.</p>'});
   return res.status(200).json({ok:true,results:[{ok:r.sent,via:r.sent?'resend':'not configured'}]});
  }
  if(!ref)return err(res,400,'Applicant reference required');
  const a=await byRef(ref);if(!a)return err(res,404,'Applicant not found');
  // Approve = Guided Builder + 24-hour payment link emailed straight away. No "under review" email.
  if(action==='approve'||(action==='review'&&req.body.decision==='accept')){
   return res.status(200).json({ok:true,...await sendPaymentLink(a)});
  }
  if(action==='review'){
   const decision=String(req.body.decision||'');
   if(a.status==='paid')return err(res,409,'Cannot reclassify confirmed attendee');
   if(decision==='future'){
    const updated=await update(ref,{classification:'Foundation',status:'foundation'});
    await mail(updated.email,futureCohort(model(updated),ref,applicationResult(updated),site()));
    return res.status(200).json({ok:true,applicant:display(updated)});
   }
   if(decision==='review'){
    // Back to review quietly: the applicant already had the "under review" email when they applied.
    const updated=await update(ref,{classification:'Review Required',status:'reviewed'});
    return res.status(200).json({ok:true,applicant:display(updated)});
   }
   return err(res,400,'Invalid decision');
  }
  // Resend the payment link (old "Invite" and "Remind" buttons both land here).
  if(action==='invite'||action==='remind'||action==='resend'){
   if(a.classification!=='Guided Builder')return err(res,403,'Approve this applicant first');
   return res.status(200).json({ok:true,...await sendPaymentLink(a)});
  }
  return err(res,404,'Unknown administrator action');
 }catch(e){console.error('Admin operation failed',e.message);return err(res,e.http||503,e.http?e.message:'Admin operation could not be completed');}
}
