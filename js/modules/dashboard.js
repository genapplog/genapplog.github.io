/**
 * ARQUIVO: js/modules/dashboard.js
 * DESCRIÇÃO: Dashboard Operacional, Relatórios, Impressão e Modo TV (Wallboard).
 */

import { safeBind, escapeHtml } from '../utils.js';
import { exportRncToXlsx, exportPalletToXlsx, printRncById } from './reports.js';
import { CHART_COLORS, COMMON_OPTIONS, DOUGHNUT_OPTIONS } from './charts-config.js';

// --- ESTADO GERAL ---
let localAllData = [];
let ChartLib = null;

// Instâncias de Gráficos
let chartTypeInstance = null, chartLocalInstance = null, chartCausadorInstance = null, chartIdentificadorInstance = null;
let tvChartTypeInstance = null, tvChartLocalInstance = null, tvChartCausadorInstance = null, tvChartIdentificadorInstance = null;
let tvClockInterval = null;

// =========================================================
// CARREGAMENTO DINÂMICO (CHART.JS)
// =========================================================
async function loadChartLib() {
    if (ChartLib) return ChartLib;
    try {
        await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
        ChartLib = window.Chart;
        return ChartLib;
    } catch (e) {
        console.warn("Chart.js Offline.");
        return null;
    }
}

// =========================================================
// INICIALIZAÇÃO
// =========================================================
export function initDashboard() {
    console.log("Iniciando Módulo Dashboard...");

    // Filtros
    safeBind('btn-dash-filter-apply', 'click', () => applyDashboardFilters());
    safeBind('btn-dash-filter-clear', 'click', () => { 
        const i1 = document.getElementById('dash-filter-start');
        const i2 = document.getElementById('dash-filter-end');
        if(i1) i1.value = ''; if(i2) i2.value = '';
        applyDashboardFilters(); 
    });

    // Exportação (VIA MÓDULO REPORTS)
    safeBind('btn-dash-export', 'click', () => {
        const { start, end } = getFilterDates();
        exportRncToXlsx(start, end);
    });
    
    safeBind('btn-dash-export-pallet', 'click', () => {
        const { start, end } = getFilterDates();
        exportPalletToXlsx(start, end);
    });
    
    // Busca Histórico
    safeBind('history-search-input', 'input', () => renderHistoryTable());
    safeBind('history-search-clear', 'click', () => { 
        const i = document.getElementById('history-search-input'); 
        if(i){ i.value=''; renderHistoryTable(); } 
    });

    // TV Mode
    safeBind('btn-exit-tv', 'click', exitTVMode);
}

// Chamado pelo rnc.js quando os dados mudam
export function updateDashboardView(allData) {
    localAllData = allData;
    applyDashboardFilters(); 
    
    const tvEl = document.getElementById('tv-mode');
    if (tvEl && !tvEl.classList.contains('hidden')) updateTVView();
}

// =========================================================
// MODO TV
// =========================================================
export function startTVMode() {
    document.getElementById('tv-mode').classList.remove('hidden');
    const elem = document.documentElement;
    if (elem.requestFullscreen) { elem.requestFullscreen().catch(console.log); }
    startClock();
    updateTVView();
}

function exitTVMode() {
    document.getElementById('tv-mode').classList.add('hidden');
    if (document.exitFullscreen && document.fullscreenElement) { document.exitFullscreen(); }
    if (tvClockInterval) clearInterval(tvClockInterval);
}

function startClock() {
    const updateTime = () => {
        const now = new Date();
        const elTime = document.getElementById('tv-clock');
        const elDate = document.getElementById('tv-date');
        if(elTime) elTime.innerText = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        if(elDate) {
            const d = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
            elDate.innerText = d.charAt(0).toUpperCase() + d.slice(1);
        }
    };
    updateTime();
    if(tvClockInterval) clearInterval(tvClockInterval);
    tvClockInterval = setInterval(updateTime, 1000);
}

async function updateTVView() {
    const Chart = await loadChartLib();
    const today = new Date(); today.setHours(0,0,0,0);
    
    // Filtra dados para TV (apenas hoje e concluídos)
    const tvData = localAllData.filter(d => d.type !== 'pallet_label_request' && d.status === 'concluido' && d.jsDate >= today);

    // KPIs
    document.getElementById('tv-kpi-total').innerText = tvData.length;
    document.getElementById('tv-kpi-last').innerText = tvData.length > 0 ? tvData[0].jsDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : "-";

    // Feed Recente
    const tbody = document.getElementById('tv-list-tbody');
    tbody.innerHTML = '';
    const recent = tvData.slice(0, 8);
    
    if (recent.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-6 text-center text-slate-500 text-xl">Aguardando registros hoje...</td></tr>';
    } else {
        recent.forEach(d => {
            const tr = document.createElement('tr');
            tr.className = "border-b border-slate-800/50";
            tr.innerHTML = `<td class="p-3 text-slate-400 font-mono text-base">${d.jsDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</td><td class="p-3 text-white font-bold text-base">${escapeHtml(d.tipo)}</td><td class="p-3 text-right text-indigo-400 font-mono text-base truncate max-w-[120px]">${escapeHtml(d.embarque || d.nf)}</td>`;
            tbody.appendChild(tr);
        });
    }

    // Processamento Gráficos
    let types = { FALTA: 0, SOBRA: 0, AVARIA: 0, FALTA_INTERNA: 0 };
    let locals = { ARMAZENAGEM: 0, ESTOQUE: 0, CHECKOUT: 0, SEPARAÇÃO: 0 }; 
    let causadores = {}, identificadores = {};

    tvData.forEach(d => {
        if(types[d.tipo] !== undefined) types[d.tipo]++;
        if(locals[d.local] !== undefined) locals[d.local]++;
        const c = (d.infrator || 'N/A').toUpperCase(); causadores[c] = (causadores[c] || 0) + 1;
        const i = (d.ass_colab || 'N/A').toUpperCase(); identificadores[i] = (identificadores[i] || 0) + 1;
    });

    let maxType = "-", maxVal = -1; 
    for(const [k, v] of Object.entries(types)) if(v > maxVal && v > 0) { maxVal = v; maxType = k; }
    document.getElementById('tv-kpi-type').innerText = maxType;

    if (!Chart) return;

    // Renderiza Gráficos (Usando Helper)
    const createTVChart = (id, type, data, opts) => { 
        const ctx = document.getElementById(id); 
        if(ctx) return new Chart(ctx, { type, data, options: opts }); 
        return null; 
    };

    if (tvChartTypeInstance) tvChartTypeInstance.destroy();
    tvChartTypeInstance = createTVChart('tvChartType', 'doughnut', { 
        labels: ['Falta', 'Sobra', 'Avaria', 'Interna'], 
        datasets: [{ 
            data: [types.FALTA, types.SOBRA, types.AVARIA, types.FALTA_INTERNA], 
            backgroundColor: [CHART_COLORS.falta, CHART_COLORS.sobra, CHART_COLORS.avaria, CHART_COLORS.interna], 
            borderWidth: 0 
        }] 
    }, DOUGHNUT_OPTIONS);

    if (tvChartLocalInstance) tvChartLocalInstance.destroy();
    tvChartLocalInstance = createTVChart('tvChartLocal', 'bar', { 
        labels: ['Armaz.', 'Estoque', 'Chk', 'Sep.'], 
        datasets: [{ data: [locals.ARMAZENAGEM, locals.ESTOQUE, locals.CHECKOUT, locals.SEPARAÇÃO], backgroundColor: CHART_COLORS.sobra, borderRadius: 6 }] 
    }, COMMON_OPTIONS);

    const sortedCaus = Object.entries(causadores).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if (tvChartCausadorInstance) tvChartCausadorInstance.destroy();
    tvChartCausadorInstance = createTVChart('tvChartCausador', 'bar', { 
        labels: sortedCaus.map(i => i[0]), 
        datasets: [{ data: sortedCaus.map(i => i[1]), backgroundColor: CHART_COLORS.causador, borderRadius: 6 }] 
    }, { ...COMMON_OPTIONS, indexAxis: 'y' });

    const sortedIdent = Object.entries(identificadores).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if (tvChartIdentificadorInstance) tvChartIdentificadorInstance.destroy();
    tvChartIdentificadorInstance = createTVChart('tvChartIdentificador', 'bar', { 
        labels: sortedIdent.map(i => i[0]), 
        datasets: [{ data: sortedIdent.map(i => i[1]), backgroundColor: CHART_COLORS.identif, borderRadius: 6 }] 
    }, { ...COMMON_OPTIONS, indexAxis: 'y' });
}

// =========================================================
// DASHBOARD PADRÃO
// =========================================================
function applyDashboardFilters() {
    const iStart = document.getElementById('dash-filter-start'); 
    const iEnd = document.getElementById('dash-filter-end');
    if(!iStart || !iEnd) return;

    let startDate = iStart.value ? new Date(iStart.value + 'T00:00:00') : null; 
    let endDate = iEnd.value ? new Date(iEnd.value + 'T23:59:59') : null;
    
    const filteredRNC = localAllData.filter(d => { 
        if(d.type === 'pallet_label_request' || d.status !== 'concluido') return false;
        if(startDate && d.jsDate < startDate) return false; 
        if(endDate && d.jsDate > endDate) return false; 
        return true; 
    });
    
    updateChartsAndStats(filteredRNC);
    renderHistoryTable(filteredRNC);
}

async function updateChartsAndStats(data) {
    const Chart = await loadChartLib();
    if (!Chart) { updateKPIsOnly(data); return; }

    let types = { FALTA: 0, SOBRA: 0, AVARIA: 0, FALTA_INTERNA: 0 }; 
    let locals = { ARMAZENAGEM: 0, ESTOQUE: 0, CHECKOUT: 0, SEPARAÇÃO: 0 }; 
    let causadores = {}, identificadores = {};
    
    data.forEach(d => { 
        if(types[d.tipo] !== undefined) types[d.tipo]++; 
        if(locals[d.local] !== undefined) locals[d.local]++; 
        const nmCausador = (d.infrator || 'Não Informado').trim().toUpperCase(); 
        if(nmCausador) causadores[nmCausador] = (causadores[nmCausador] || 0) + 1; 
        const nmIdentificador = (d.ass_colab || 'Não Informado').trim().toUpperCase(); 
        if(nmIdentificador) identificadores[nmIdentificador] = (identificadores[nmIdentificador] || 0) + 1; 
    });

    updateKPIsOnly(data);

    // Fábrica de Gráficos (Reutilizável)
    const createOrUpdateChart = (id, config, inst) => { 
        const ctx = document.getElementById(id); 
        if (!ctx) return null; 
        if (inst) inst.destroy(); 
        return new Chart(ctx, config); 
    };

    chartTypeInstance = createOrUpdateChart('chartOcType', { 
        type: 'doughnut', 
        data: { 
            labels: ['Falta', 'Sobra', 'Avaria', 'Int.'], 
            datasets: [{ 
                data: [types.FALTA, types.SOBRA, types.AVARIA, types.FALTA_INTERNA], 
                backgroundColor: [CHART_COLORS.falta, CHART_COLORS.sobra, CHART_COLORS.avaria, CHART_COLORS.interna], 
                borderWidth: 0, borderRadius: 4 
            }] 
        }, 
        options: { ...DOUGHNUT_OPTIONS, plugins: { legend: { position: 'bottom', labels: { color: CHART_COLORS.text } } } }
    }, chartTypeInstance);
    
    chartLocalInstance = createOrUpdateChart('chartOcLocal', { 
        type: 'bar', 
        data: { 
            labels: ['Armazenagem', 'Estoque', 'Checkout', 'Separação'], 
            datasets: [{ label: 'Qtd', data: [locals.ARMAZENAGEM, locals.ESTOQUE, locals.CHECKOUT, locals.SEPARAÇÃO], backgroundColor: CHART_COLORS.bars, borderRadius: 4 }] 
        }, 
        options: COMMON_OPTIONS 
    }, chartLocalInstance);
    
    const sCaus = Object.entries(causadores).sort((a, b) => b[1] - a[1]).slice(0, 10);
    chartCausadorInstance = createOrUpdateChart('chartOcCausador', { 
        type: 'bar', 
        data: { labels: sCaus.map(i=>i[0]), datasets: [{ data: sCaus.map(i=>i[1]), backgroundColor: CHART_COLORS.causador, borderRadius: 4 }] }, 
        options: { ...COMMON_OPTIONS, indexAxis: 'y' } 
    }, chartCausadorInstance);
    
    const sIdent = Object.entries(identificadores).sort((a, b) => b[1] - a[1]).slice(0, 10);
    chartIdentificadorInstance = createOrUpdateChart('chartOcIdentificador', { 
        type: 'bar', 
        data: { labels: sIdent.map(i=>i[0]), datasets: [{ data: sIdent.map(i=>i[1]), backgroundColor: CHART_COLORS.identif, borderRadius: 4 }] }, 
        options: { ...COMMON_OPTIONS, indexAxis: 'y' } 
    }, chartIdentificadorInstance);
}

function updateKPIsOnly(data) {
    const total = data.length; 
    let types = { FALTA: 0, SOBRA: 0, AVARIA: 0, FALTA_INTERNA: 0 }; 
    data.forEach(d => { if(types[d.tipo] !== undefined) types[d.tipo]++; });

    document.getElementById('dash-total-oc').innerText = total; 
    document.getElementById('dash-last-date').innerText = (total > 0 && data[0].jsDate) ? data[0].jsDate.toLocaleDateString('pt-BR') : "-";
    
    let maxType = "-", maxVal = -1; for(const [k, v] of Object.entries(types)) if(v > maxVal && v > 0) { maxVal = v; maxType = k; }
    document.getElementById('dash-top-type').innerText = maxType;
}

function renderHistoryTable(dataToRender) {
    const tbody = document.getElementById('history-list-tbody'); 
    const searchInput = document.getElementById('history-search-input'); 
    const clearBtn = document.getElementById('history-search-clear'); 
    if (!tbody) return;

    let sourceData = dataToRender || localAllData.filter(d => d.type !== 'pallet_label_request' && d.status === 'concluido');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";
    if(clearBtn) clearBtn.classList.toggle('hidden', searchTerm === '');

    const list = sourceData.filter(item => { 
        if (!searchTerm) return true; 
        const combined = (item.nf||'') + (item.embarque||'') + (item.tipo||'');
        return combined.toLowerCase().includes(searchTerm);
    });

    tbody.innerHTML = '';
    if (list.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-8 text-center text-slate-500 italic">Nenhum registro encontrado.</td></tr>'; return; }
    
    const truncatedList = list.slice(0, 10);
    truncatedList.forEach(item => {
        const tr = document.createElement('tr'); 
        tr.className = "border-b border-slate-700 hover:bg-slate-750 transition-colors";
      tr.innerHTML = `<td class="px-4 py-3 font-mono text-slate-300 text-xs"><span class="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>${item.jsDate.toLocaleDateString('pt-BR')}</td><td class="px-4 py-3 text-white font-medium text-sm">${escapeHtml(item.embarque || '-')}<br><span class="text-slate-500 text-[10px] font-normal">${escapeHtml(item.nf || '-')}</span></td><td class="px-4 py-3 text-slate-300 text-xs">${escapeHtml(item.tipo)}</td><td class="px-4 py-3 text-right"><button class="text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded transition btn-print-history flex items-center gap-2 ml-auto text-xs" data-id="${item.id}">Imprimir</button></td>`;
        tbody.appendChild(tr);
    });
    // Usa a função do módulo reports
    tbody.querySelectorAll('.btn-print-history').forEach(btn => btn.addEventListener('click', (e) => printRncById(e.currentTarget.dataset.id)));
}

// Helper para obter datas do filtro
function getFilterDates() {
    const iStart = document.getElementById('dash-filter-start'); 
    const iEnd = document.getElementById('dash-filter-end');
    
    let start = iStart.value ? new Date(iStart.value + 'T00:00:00') : new Date(new Date().setDate(1));
    let end = iEnd.value ? new Date(iEnd.value + 'T23:59:59') : new Date();
    
    return { start, end };
}