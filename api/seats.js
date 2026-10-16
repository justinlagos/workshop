import {seats,configured,method} from './_shared.js';
export default async function handler(req,res){
 if(!method(req,res,'GET'))return;
 if(!configured())return res.status(503).json({ok:false,error:'Booking database configuration pending'});
 try{return res.status(200).json({ok:true,...await seats()});}
 catch(e){return res.status(503).json({ok:false,error:'Seat availability temporarily unavailable'});}
}
