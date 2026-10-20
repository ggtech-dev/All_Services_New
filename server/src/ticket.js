import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

// 🚗 Share Ride: the UPI payment link and the PDF e-ticket of a booking (b = fn_ride_booking()).
// The standard PDF fonts have no ₹ sign, so amounts are written "Rs." on the ticket.

const IST = { timeZone: 'Asia/Kolkata' };
const when = (d) => new Date(d).toLocaleString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const rs = (n) => `Rs. ${Number(n).toLocaleString('en-IN')}`;

// upi://pay link that opens the customer's UPI app with the owner, amount and booking code filled in.
export function upiLink(b) {
  const p = new URLSearchParams({ pa: b.ride.upi_id, pn: b.owner_name || 'Car owner', am: Number(b.amount).toFixed(2), cu: 'INR', tn: `Share Ride ${b.code}` });
  return `upi://pay?${p.toString()}`;
}

export async function ticketPdf(b) {
  const qr = await QRCode.toBuffer(
    `${b.code} | ${b.ride.from_place} > ${b.ride.to_place} | ${when(b.ride.depart_at)} | ${b.car.reg_number} | Seats ${b.passengers.map((p) => p.label).join(', ')}`,
    { margin: 1, width: 240 });
  const doc = new PDFDocument({ size: 'A5', margin: 32, info: { Title: `Share Ride ticket ${b.code}`, Author: 'All Services by GGTech' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width - 64;
  const purple = '#6d28d9';
  // header band
  doc.rect(0, 0, doc.page.width, 78).fill(purple);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text('Share Ride', 32, 20);
  doc.font('Helvetica').fontSize(10).text('All Services by GGTech  ·  e-ticket', 32, 46);
  doc.font('Helvetica-Bold').fontSize(14).text(b.code, 32, 26, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(9).text('CONFIRMED', 32, 48, { width: W, align: 'right' });

  // route
  let y = 96;
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(18).text(`${b.ride.from_place}  >  ${b.ride.to_place}`, 32, y, { width: W - 120 });
  y = doc.y + 4;
  doc.font('Helvetica').fontSize(11).fillColor('#333').text(when(b.ride.depart_at), 32, y, { width: W - 120 });
  doc.image(qr, 32 + W - 104, 92, { width: 104 });

  const row = (label, value) => {
    y = Math.max(doc.y, y) + 8;
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(label.toUpperCase(), 32, y, { width: 110 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(value, 145, y, { width: W - 113 });
  };
  y = 210;
  doc.moveTo(32, y - 8).lineTo(32 + W, y - 8).strokeColor('#e5e7eb').stroke();
  row('Pickup', b.pickup_point);
  row('Drop', b.drop_point);
  row('Car', `${b.car.model} · ${b.car.reg_number}${b.car.color ? ` · ${b.car.color}` : ''}`);
  row('Car owner', `${b.owner_name}${b.owner_phone ? `  ·  +91 ${b.owner_phone}` : ''}`);
  row('Passengers', b.passengers.map((p) => `${p.name} — ${p.label} (${rs(p.price)})`).join('\n'));
  row('Contact', `+91 ${b.contact_phone}`);
  row('Amount', `${rs(b.amount)}  ·  ${b.pay_mode === 'cash' ? 'TO PAY IN CASH AT PICKUP' : `Paid by UPI${b.utr ? ` (ref ${b.utr})` : ''}`}`);

  // rules
  y = Math.max(doc.y, y) + 16;
  doc.roundedRect(32, y, W, 74, 8).fillAndStroke('#faf5ff', '#ddd6fe');
  doc.fillColor('#4c1d95').font('Helvetica-Bold').fontSize(9.5)
    .text('No cancellation, no refund once the payment is confirmed.', 42, y + 9, { width: W - 20 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#4c1d95')
    .text('If the car owner cancels the journey, the owner returns your full amount. Please reach the pickup point 10 minutes early and show this ticket. '
      + 'All Services only lists the journey: the payment is made directly to the car owner, who is responsible for the trip.', 42, doc.y + 3, { width: W - 20 });
  doc.fontSize(8).fillColor('#9ca3af').text(`Booked ${when(b.created_at)}  ·  allservicesapp.in`, 32, doc.page.height - 44, { width: W, align: 'center' });
  doc.end();
  return done;
}
