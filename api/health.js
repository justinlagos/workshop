export default function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
 res.setHeader('Cache-Control','no-store');
 const ready=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.RESEND_API_KEY&&((process.env.STRIPE_PAYMENT_MODE==='live' && process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) || (process.env.STRIPE_PAYMENT_MODE==='test' && process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')))&&process.env.STRIPE_WEBHOOK_SECRET&&process.env.ADMIN_TOKEN);
 return res.status(200).json({ok:true,hosting:'vercel',registrationReady:ready,paymentsMode:ready?process.env.STRIPE_PAYMENT_MODE:'disabled'});
}
