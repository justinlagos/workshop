export default function handler(req,res) { res.status(503).json({ok:false,error:'Booking availability is being configured. No seats can be reserved yet.'}); }
