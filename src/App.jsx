import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';

function App() {
  const [shopName, setShopName] = useState(localStorage.getItem('shopName') || 'Your Shop Name');
  const [upiIds, setUpiIds] = useState(JSON.parse(localStorage.getItem('upiIds') || '[""]'));
  const [amount, setAmount] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [qrs, setQrs] = useState([]);
  const [history, setHistory] = useState(JSON.parse(localStorage.getItem('qrHistory') || '[]'));
  const [view, setView] = useState('home'); // home, history, historyDetail
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState({}); // {0: true, 1: false}

  useEffect(() => {
    localStorage.setItem('shopName', shopName);
    localStorage.setItem('upiIds', JSON.stringify(upiIds));
    localStorage.setItem('qrHistory', JSON.stringify(history));
  }, [shopName, upiIds, history]);

  // Masked UPI - th****op@oksbi
  const getMaskedUpi = (upi) => {
    if (!upi ||!upi.includes('@')) return upi;
    const [name, domain] = upi.split('@');
    if (name.length <= 4) return `${name[0]}****${name.slice(-1)}@${domain}`;
    return `${name.slice(0,2)}****${name.slice(-2)}@${domain}`;
  };

  // CORE SPLITTING LOGIC - V23
  const splitAmount = (total) => {
    total = parseInt(total);
    if (total <= 1999) return [total];

    let n = Math.floor(total / 1999);
    let isMultiple = total % 1999 === 0;
    let numQRs = isMultiple? n + 1 : n + 1;
    if (total % 1999!== 0) numQRs = Math.ceil(total / 1999);
    if (isMultiple) numQRs = n + 1; // Extra QR Rule - 3998=3, 5997=4

    // Generate random unique non-sequential with gap
    let amounts = [];
    let remaining = total;
    let attempts = 0;

    while (amounts.length < numQRs - 1) {
      let maxForThis = Math.min(1999, remaining - (numQRs - amounts.length - 1) * 100);
      let minForThis = 100;
      if (maxForThis < minForThis) break;

      let rand = Math.floor(Math.random() * (maxForThis - minForThis + 1)) + minForThis;
      // Ensure uniqueness and non-sequential and gap > 50
      if (!amounts.includes(rand) &&!amounts.includes(rand+1) &&!amounts.includes(rand-1) && amounts.every(a => Math.abs(a - rand) > 30)) {
        amounts.push(rand);
        remaining -= rand;
      }
      attempts++;
      if (attempts > 5000) { // Fallback deterministic
        amounts = []; remaining = total; attempts = 0; numQRs++;
      }
    }
    if (remaining >= 100 && remaining <= 1999 &&!amounts.includes(remaining)) {
      amounts.push(remaining);
    } else {
      // Adjust last
      let sum = amounts.reduce((a,b)=>a+b,0);
      amounts.push(total - sum);
    }
    // Final validation - if any <100 or duplicate, regenerate with more QRs
    if (amounts.some(a => a < 100 || a > 1999) || new Set(amounts).size!== amounts.length) {
      return splitAmount(total); // retry
    }
    return amounts.sort(()=>Math.random()-0.5); // shuffle for pure random
  };

  const generateQRs = async () => {
    if (!amount ||!upiIds[0]) return alert('Amount and UPI required');
    const total = parseInt(amount);
    const splits = splitAmount(total);
    const upi = upiIds[0]; // Use first UPI for now

    const qrData = await Promise.all(splits.map(async (amt, i) => {
      const upiString = `upi://pay?pa=${upi}&pn=${encodeURIComponent(shopName)}&am=${amt}&cu=INR&tn=${encodeURIComponent(customerName || 'Payment')}`;
      const qrUrl = await QRCode.toDataURL(upiString, { width: 400 });
      return { id: i+1, amount: amt, upiString, qrUrl, upiMasked: getMaskedUpi(upi) };
    }));
    setQrs(qrData);
    const statusInit = {};
    qrData.forEach((_, idx) => statusInit[idx] = false);
    setPaymentStatus(statusInit);
  };

  const generateJPEG = (qr) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = 600; canvas.height = 750;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white'; ctx.fillRect(0,0,600,750);
      ctx.fillStyle = 'black'; ctx.font = 'bold 28px Arial'; ctx.textAlign = 'center';
      ctx.fillText(shopName, 300, 50);
      ctx.font = '18px Arial'; ctx.textAlign = 'left';
      ctx.fillText(`QR ${qr.id}`, 20, 90);
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 100, 110, 400, 400);
        ctx.textAlign = 'center'; ctx.font = 'bold 24px Arial';
        ctx.fillText(`₹${qr.amount}`, 300, 560);
        ctx.font = '16px Arial'; ctx.fillText(qr.upiMasked, 300, 600);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.src = qr.qrUrl;
    });
  };

  const shareSingle = async (qr) => {
    const dataUrl = await generateJPEG(qr);
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `QR${qr.id}_${qr.amount}.jpg`, { type: 'image/jpeg' });
    if (navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `Payment QR ${qr.amount}` });
    } else {
      const a = document.createElement('a'); a.href = dataUrl; a.download = `QR${qr.id}.jpg`; a.click();
    }
  };

  const shareAll = async () => {
    const files = [];
    for (let qr of qrs) {
      const dataUrl = await generateJPEG(qr);
      const blob = await (await fetch(dataUrl)).blob();
      files.push(new File([blob], `QR${qr.id}_${qr.amount}.jpg`, { type: 'image/jpeg' }));
    }
    if (navigator.share && navigator.canShare({ files })) {
      await navigator.share({ files, title: `Total ${amount} - ${customerName}` });
    } else {
      alert('Share All not supported in browser, will download. In APK it will work.');
      files.forEach(f => {
        const url = URL.createObjectURL(f);
        const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
      });
    }
  };

  const handlePaymentDone = () => {
    // If single QR and all unchecked -> Delete (your Case A logic)
    const anyChecked = Object.values(paymentStatus).some(v => v === true);
    if (qrs.length === 1 &&!anyChecked) {
      if (confirm('No UPI paid? Delete this transaction? (Cash paid)')) {
        setQrs([]); return;
      }
    }
    // Case B - Save full transaction
    const newEntry = {
      id: Date.now(),
      totalAmount: parseInt(amount),
      customerName: customerName || 'Unknown',
      shopName,
      date: new Date().toLocaleString(),
      splits: qrs.map((qr, idx) => ({
        qrNo: qr.id,
        amount: qr.amount,
        status: paymentStatus[idx]? 'UPI_PAID' : 'CASH',
        tick: paymentStatus[idx]
      })),
      maskedUpi: qrs[0]?.upiMasked
    };
    setHistory([newEntry,...history]);
    setQrs([]); setAmount(''); setCustomerName('');
    setView('history');
  };

  return (
    <div style={{ padding: 15, fontFamily: 'Arial', maxWidth: 500, margin: 'auto' }}>
      <h2>{shopName}</h2>
      <button onClick={()=>setView(view==='history'?'home':'history')}>{view==='history'?'Home':'History'}</button>

      {view === 'home' && (
        <>
          <input value={shopName} onChange={e=>setShopName(e.target.value)} placeholder="Your Shop Name" style={{width:'100%', margin:'5px 0', padding:8}}/>
          {upiIds.map((upi,i)=><div key={i}><input value={upi} onChange={e=>{const n=[...upiIds]; n[i]=e.target.value; setUpiIds(n)}} placeholder="UPI ID" style={{width:'80%', padding:8}}/> <button onClick={()=>setUpiIds(upiIds.filter((_,j)=>j!==i))}>X</button> <small>{getMaskedUpi(upi)}</small></div>)}
          <button onClick={()=>setUpiIds([...upiIds,''])}>+ Add UPI</button>
          <hr/>
          <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Total Amount" style={{width:'100%', padding:10, margin:'10px 0'}}/>
          <input value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="Customer Name (for tn narration - locked)" style={{width:'100%', padding:10}}/>
          <button onClick={generateQRs} style={{width:'100%', padding:12, marginTop:10, background:'green', color:'white'}}>Generate Dynamic QR</button>

          {qrs.length>0 && <div><h3>Total: ₹{amount} - {qrs.length} QRs</h3><button onClick={shareAll} style={{width:'100%', padding:10, background:'blue', color:'white'}}>Share All ({qrs.length} JPEGs)</button></div>}
          {qrs.map((qr,i)=><div key={i} style={{border:'1px solid #ccc', margin:10, padding:10, textAlign:'center'}}>
            <small style={{float:'left'}}>QR {qr.id}</small><small>{qr.upiMasked}</small>
            <img src={qr.qrUrl} style={{width:200}}/>
            <h3>₹{qr.amount}</h3>
            <label><input type="checkbox" checked={paymentStatus[i]} onChange={e=>setPaymentStatus({...paymentStatus, [i]: e.target.checked})}/> UPI Paid (Tick for history)</label><br/>
            <button onClick={()=>shareSingle(qr)}>Share QR {qr.id}</button>
          </div>)}
          {qrs.length>0 && <button onClick={handlePaymentDone} style={{width:'100%', padding:15, background:'black', color:'white', marginTop:20}}>Payment Done - Save to History</button>}
        </>
      )}

      {view === 'history' && (
        <div>
          <h3>History</h3>
          {history.map(h=><div key={h.id} onClick={()=>{setSelectedHistory(h); setView('historyDetail')}} style={{border:'1px solid #ccc', padding:10, margin:10}}>
            <b style={{fontSize:18}}>Total: ₹{h.totalAmount}</b><br/>
            Customer: {h.customerName}<br/>
            <small>{h.date} - {h.splits.length} QRs</small>
          </div>)}
          {history.length===0 && <p>No history</p>}
        </div>
      )}

      {view === 'historyDetail' && selectedHistory && (
        <div>
          <button onClick={()=>setView('history')}>Back</button>
          <h3>Customer: {selectedHistory.customerName}</h3>
          <h2>Total: ₹{selectedHistory.totalAmount} - {selectedHistory.splits.length} QRs</h2>
          <small>{selectedHistory.date}</small>
          {selectedHistory.splits.map(s=><div key={s.qrNo} style={{padding:10, borderBottom:'1px solid #eee', color: s.tick? 'green' : 'red'}}>
            QR {s.qrNo} - ₹{s.amount} - {s.tick? 'UPI Paid ✅' : 'Cross ❌ (Paid in Cash)'}
          </div>)}
          <button onClick={()=>{setHistory(history.filter(x=>x.id!==selectedHistory.id)); setView('history')}} style={{background:'red', color:'white', padding:10, marginTop:10}}>Delete</button>
        </div>
      )}
    </div>
  );
}
export default App;
