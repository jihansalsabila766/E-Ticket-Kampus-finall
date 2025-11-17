async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

// index.html logic
if (document.getElementById('events')) {
  (async ()=>{
    const events = await fetchJSON('/api/events');
    const container = document.getElementById('events');
    if (events.length===0) {
      container.innerHTML = '<p>Belum ada event. Buat di <a href="/admin.html">Admin</a>.</p>';
    }
    events.forEach((ev, i)=>{
      const el = document.createElement('div');
      el.className='col-md-3';
      const accent = `accent-${(i % 8) + 1}`;
      el.innerHTML = `
        <div class="card shadow-sm h-100 ${accent}">
          <div class="card-body d-flex flex-column">
            <h5 class="card-title">${ev.title}</h5>
            <p class="card-text small">${ev.description||''}</p>
            <p><strong>Rp${ev.price}</strong><br><span class="text-muted">${ev.date}</span></p>
            <a href="/event.html?id=${ev.id}" class="btn btn-primary mt-auto">Beli Tiket</a>
          </div>
        </div>`;
      container.appendChild(el);
    });
  })();
}

// event.html logic
if (document.getElementById('title') && location.search.includes('id=')) {
  (async ()=>{
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) {
      document.querySelector('.container').innerHTML = '<div class="alert alert-danger">❌ Event tidak ditemukan</div>';
      return;
    }

    // ambil detail event
    const ev = await fetchJSON(`/api/events/${id}`);
    if (!ev || ev.error) {
      document.querySelector('.container').innerHTML = '<div class="alert alert-danger">❌ Event tidak tersedia</div>';
      return;
    }

    // tampilkan data event
    document.getElementById('title').textContent = ev.title;
    document.getElementById('desc').textContent = ev.description;
    document.getElementById('date').textContent = ev.date;
    document.getElementById('price').textContent = ev.price;

    // handle checkout
    document.getElementById('checkoutForm').addEventListener('submit', async e=>{
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        event_id:id,
        buyer_name:fd.get('buyer_name'),
        buyer_email:fd.get('buyer_email')
      };
      const r = await fetchJSON('/api/checkout',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });

      const result = document.getElementById('result');
      result.classList.remove('d-none');
      if (r.error) {
        result.className = 'alert alert-danger';
        result.textContent = "Gagal membuat tiket: " + r.error;
      } else {
        result.className = 'alert alert-success';
        result.innerHTML = `
          <p><b>ID Tiket:</b> ${r.ticketId}</p>
          <p><b>Validasi:</b> <a href="${r.validationUrl}" target="_blank">${r.validationUrl}</a></p>
          <img src="${r.qrDataUrl}" alt="QR Code Tiket" class="img-fluid mt-2" />
        `;
      }
    });
  })();
}
