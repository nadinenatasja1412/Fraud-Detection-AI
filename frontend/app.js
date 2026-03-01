/**Paylabs RingShield - Dashboard logic
Force-directed graph (vis.js), live alerts, Qwen Insight, polling
 * **/
(function () {
  const API_BASE = window.location.origin;
  const POLL_INTERVAL = 5000;

  let network = null;
  let lastInsight = null;

  function get(id) {
    return document.getElementById(id);
  }

  // ---------- Graph ----------
  function initGraph() {
    const container = get('graph');
    if (!container || typeof vis === 'undefined') return;
    const nodes = new vis.DataSet([]);
    const edges = new vis.DataSet([]);
    network = new vis.Network(container, { nodes, edges }, {
      nodes: {
        shape: 'dot',
        size: 18,
        color: { background: '#ef4444', border: '#b91c1c' },
        font: { color: '#e4e4e7', size: 12 },
      },
      edges: {
        color: { color: '#ef4444' },
        arrows: { to: { enabled: true, scaleFactor: 0.6 } },
        width: 1.5,
      },
      physics: {
        enabled: true,
        forceAtlas2Based: {
          gravitationalConstant: -30,
          centralGravity: 0.01,
          springLength: 150,
          springConstant: 0.08,
        },
        solver: 'forceAtlas2Based',
        stabilization: { iterations: 100 },
      },
      interaction: { hover: true },
    });
  }

  function updateGraph(data) {
    if (!data || !network) return;
    const nodes = (data.nodes || []).map((n) => ({
      id: n.id,
      label: n.label || n.id,
      title: n.id,
    }));
    const edges = (data.edges || []).map((e, i) => ({
      id: 'e' + i,
      from: e.from,
      to: e.to,
      label: e.match_pct ? e.match_pct + '%' : '',
      title: (e.label || '') + (e.match_pct ? ' ' + e.match_pct + '%' : ''),
    }));
    network.body.data.nodes.clear();
    network.body.data.edges.clear();
    if (nodes.length) network.body.data.nodes.add(nodes);
    if (edges.length) network.body.data.edges.add(edges);
    const pct = nodes.length ? Math.min(100, 30 + nodes.length * 20) : 0;
    get('graphStatus').textContent = pct + '%';
    const metricDevice = edges.length ? (edges[0].label || '98%') : '0%';
    get('metricDevice').textContent = typeof metricDevice === 'string' ? metricDevice : '98%';
  }

  function fetchGraph() {
    fetch(API_BASE + '/api/graph')
      .then((r) => r.json())
      .then((data) => updateGraph(data))
      .catch(() => updateGraph({ nodes: [], edges: [] }));
  }

  // ---------- Alerts ----------
  function renderAlerts(list) {
    const el = get('alertsFeed');
    if (!el) return;
    if (!list || list.length === 0) {
      el.innerHTML = '<div class="alert-card low"><span class="title">No alerts</span><span class="detail">Transaksi aman</span></div>';
      return;
    }
    el.innerHTML = list
      .map(
        (a) =>
          '<div class="alert-card ' +
          (a.type || 'low') +
          '">' +
          '<div class="title">' +
          (a.title || 'Alert') +
          (a.score != null ? ' - Score ' + a.score : '') +
          '</div>' +
          '<div class="detail">' +
          (a.detail || '') +
          '</div>' +
          '</div>'
      )
      .join('');
  }

  function fetchAlerts() {
    fetch(API_BASE + '/api/alerts')
      .then((r) => r.json())
      .then(renderAlerts)
      .catch(() => renderAlerts([]));
  }

  // ---------- Qwen Insight ----------
  function setInsight(explanation, recommendation, payload) {
    lastInsight = payload;
    get('insightContent').querySelector('.insight-text').textContent = explanation || 'Menunggu analisis transaksi...';
    const recEl = get('insightRecommendation');
    recEl.textContent = recommendation || '';
    recEl.style.display = recommendation ? 'block' : 'none';
  }

  function fetchLastInsight() {
    fetch(API_BASE + '/api/alerts')
      .then((r) => r.json())
      .then((alerts) => {
        const withInsight = alerts.find((a) => a.explanation || a.recommendation);
        if (withInsight) {
          setInsight(
            withInsight.explanation || withInsight.detail || 'Ring terdeteksi.',
            withInsight.recommendation ? 'Rekomendasi: ' + withInsight.recommendation + '.' : '',
            withInsight
          );
        }
      })
      .catch(() => {});
  }

  // ---------- Action buttons ----------
  function onBlockAll() {
    if (lastInsight) {
      console.log('Action: Block All', lastInsight);
      alert('Block All: Semua transaksi dari nomor terkait akan diblokir.');
    } else {
      alert('Pilih alert terlebih dahulu atau tunggu hasil analisis.');
    }
  }
  function onChallengeOTP() {
    if (lastInsight) {
      console.log('Action: Challenge OTP', lastInsight);
      alert('Challenge OTP: Transaksi memerlukan verifikasi OTP.');
    } else {
      alert('Pilih alert terlebih dahulu.');
    }
  }
  function onProceed() {
    if (lastInsight) {
      console.log('Action: Proceed', lastInsight);
      alert('Proceed: Transaksi diperbolehkan / lanjut ke pembayaran.');
    } else {
      alert('Tidak ada insight untuk dilanjutkan.');
    }
  }

  get('btnBlockAll').addEventListener('click', onBlockAll);
  get('btnChallengeOTP').addEventListener('click', onChallengeOTP);
  get('btnProceed').addEventListener('click', onProceed);

  // ---------- Polling ----------
  function poll() {
    fetchGraph();
    fetchAlerts();
    fetchLastInsight();
  }

  initGraph();
  poll();
  setInterval(poll, POLL_INTERVAL);
})();
