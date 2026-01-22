/**
 * ARQUIVO: js/modules/dashboard.js
 * DESCRIÇÃO: Dashboard Operacional, Relatórios e Wallboard (Modo TV).
 */

import { getFirestore, collection, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { safeBind, escapeHtml } from '../utils.js';
import { PATHS } from '../config.js'; 
import { exportRncToXlsx, exportPalletToXlsx, printRncById } from './reports.js';
import { CHART_COLORS, COMMON_OPTIONS, DOUGHNUT_OPTIONS } from './charts-config.js';
import { getUserRole, isProfileLoaded } from './auth.js'; // ✅ Importação ÚNICA e CORRETA

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
// INICIALIZAÇÃO (COM PROTEÇÃO DE ACESSO)
// =========================================================
export function initDashboard() {
    // Função interna que executa a carga real
    const startLoading = () => {
        // 🔒 VERIFICAÇÃO DE SEGURANÇA
        const roles = getUserRole() || [];
        const canViewDashboard = roles.some(r => ['ADMIN', 'LIDER', 'INVENTARIO'].includes(r));

        if (!canViewDashboard) {
            console.log("🔒 Perfil Operacional: Dashboard bloqueado.");
            const dashContainer = document.getElementById('dashboard-content');
            if(dashContainer) {
                dashContainer.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-64 text-slate-400">
                        <svg class="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                        </svg>
                        <p class="text-lg font-medium">Acesso Restrito</p>
                        <p class="text-sm opacity-70">Utilize o menu lateral para acessar suas funções.</p>
                    </div>`;
            }
            return; // ⛔ PARA AQUI se for operador
        }

        console.log("📊 Permissão confirmada. Iniciando Dashboard...");

        // Configuração de Datas (Mês Vigente)
        const date = new Date();
        const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
        const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);

        const toInputDate = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const iStart = document.getElementById('dash-filter-start');
        const iEnd = document.getElementById('dash-filter-end');

        if(iStart && !iStart.value) iStart.value = toInputDate(firstDay);
        if(iEnd && !iEnd.value) iEnd.value = toInputDate(lastDay);

        // Bindings dos Filtros
        safeBind('btn-dash-filter-apply', 'click', () => applyDashboardFilters());
        safeBind('btn-dash-filter-clear', 'click', () => { 
            if(iStart) iStart.value = ''; 
            if(iEnd) iEnd.value = '';
            applyDashboardFilters(); 
        });

        // Exportação
        safeBind('btn-dash-export', 'click', () => {
            const { start, end } = getFilterDates();
            exportRncToXlsx(start, end);
        });
        
        safeBind('btn-dash-export-pallet', 'click', () => {
            const { start, end } = getFilterDates();
            exportPalletToXlsx(start, end);
        });
        
        // Histórico
        safeBind('history-search-input', 'input', () => renderHistoryTable());
        safeBind('history-search-clear', 'click', () => { 
            const i = document.getElementById('history-search-input'); 
            if(i){ i.value=''; renderHistoryTable(); } 
        });

        // TV Mode
        safeBind('btn-exit-tv', 'click', exitTVMode);

        // Carga Inicial dos Dados
        applyDashboardFilters();
    };

    // ⏳ LÓGICA DE ESPERA (Race Condition Fix)
    // Garante que o auth.js terminou de carregar o perfil antes de decidir
    if (isProfileLoaded()) {
        startLoading();
    } else {
        console.log("⏳ Dashboard aguardando perfil...");
        document.addEventListener('user-profile-ready', startLoading, { once: true });
    }
}

// Chamado pelo rnc.js quando os dados mudam
export function updateDashboardView(allData) {
    // Só atualiza se tiver permissão
    const roles = getUserRole() || [];
    if (!roles.some(r => ['ADMIN', 'LIDER', 'INVENTARIO'].includes(r))) return;

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

    const tvChartOptions = {
        ...COMMON_OPTIONS,
        indexAxis: 'y',
        maintainAspectRatio: false,
        scales: {
            x: { 
                beginAtZero: true, 
                grid: { color: 'rgba(255, 255, 255, 0.1)' },
                ticks: { color: '#cbd5e1', font: { size: 14 } } 
            },
            y: { 
                grid: { display: false },
                ticks: { 
                    color: '#ffffff',
                    autoSkip: false,
                    font: { size: 14, weight: 'bold' }
                } 
            }
        },
        plugins: { legend: { display: false } }
    };

    const sortedCaus = Object.entries(causadores).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if (tvChartCausadorInstance) tvChartCausadorInstance.destroy();
    tvChartCausadorInstance = createTVChart('tvChartCausador', 'bar', { 
        labels: sortedCaus.map(i => i[0]), 
        datasets: [{ label: 'Qtd', data: sortedCaus.map(i => i[1]), backgroundColor: CHART_COLORS.causador, borderRadius: 6 }] 
    }, tvChartOptions);

    const sortedIdent = Object.entries(identificadores).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if (tvChartIdentificadorInstance) tvChartIdentificadorInstance.destroy();
    tvChartIdentificadorInstance = createTVChart('tvChartIdentificador', 'bar', { 
        labels: sortedIdent.map(i => i[0]), 
        datasets: [{ label: 'Qtd', data: sortedIdent.map(i => i[1]), backgroundColor: CHART_COLORS.identif, borderRadius: 6 }] 
    }, tvChartOptions);
}

// =========================================================
// DASHBOARD PADRÃO (CONSULTA ECONÔMICA)
// =========================================================
async function applyDashboardFilters() {
    // 🔒 Proteção Extra: Se não for gestão, nem tenta buscar
    const roles = getUserRole() || [];
    if (!roles.some(r => ['ADMIN', 'LIDER', 'INVENTARIO'].includes(r))) return;

    const iStart = document.getElementById('dash-filter-start'); 
    const iEnd = document.getElementById('dash-filter-end');
    if(!iStart || !iEnd) return;

    const btn = document.getElementById('btn-dash-filter-apply');
    if (btn && btn.disabled) return;
    
    const originalContent = btn ? btn.innerHTML : 'Filtrar'; 
    if(btn) {
        btn.disabled = true; 
        btn.innerHTML = `<span class="animate-pulse">Buscando...</span>`; 
    }

    try {
        const db = getFirestore();
        let startDate = iStart.value ? new Date(iStart.value + 'T00:00:00') : new Date();
        let endDate = iEnd.value ? new Date(iEnd.value + 'T23:59:59') : new Date();

        const q = query(
            collection(db, PATHS.occurrences),
            where('createdAt', '>=', startDate),
            where('createdAt', '<=', endDate),
            orderBy('createdAt', 'desc')
        );

        const querySnapshot = await getDocs(q);
        const fetchedData = [];

        querySnapshot.forEach((doc) => {
            const d = doc.data();
            d.id = doc.id;
            d.jsDate = d.createdAt?.toDate ? d.createdAt.toDate() : new Date();
            
            if (d.type !== 'pallet_label_request' && d.status === 'concluido') {
                fetchedData.push(d);
            }
        });

        localAllData = fetchedData; 
        updateChartsAndStats(fetchedData);
        renderHistoryTable(fetchedData);

    } catch (error) {
        console.error("Erro ao buscar dados:", error);
    } finally {
        if(btn) {
            btn.innerHTML = originalContent;
            btn.disabled = false;
        }
    }
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
    
    const horizOptions = {
        ...COMMON_OPTIONS,
        indexAxis: 'y',
        maintainAspectRatio: false,
        scales: {
            x: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
            y: { grid: { display: false }, ticks: { color: '#e2e8f0', autoSkip: false, font: { size: 10 } } }
        }
    };

    const sCaus = Object.entries(causadores).sort((a, b) => b[1] - a[1]).slice(0, 10);
    chartCausadorInstance = createOrUpdateChart('chartOcCausador', { 
        type: 'bar', 
        data: { labels: sCaus.map(i=>i[0]), datasets: [{ label: 'Qtd', data: sCaus.map(i=>i[1]), backgroundColor: CHART_COLORS.causador, borderRadius: 4 }] }, 
        options: horizOptions 
    }, chartCausadorInstance);
    
    const sIdent = Object.entries(identificadores).sort((a, b) => b[1] - a[1]).slice(0, 10);
    chartIdentificadorInstance = createOrUpdateChart('chartOcIdentificador', { 
        type: 'bar', 
        data: { labels: sIdent.map(i=>i[0]), datasets: [{ label: 'Qtd', data: sIdent.map(i=>i[1]), backgroundColor: CHART_COLORS.identif, borderRadius: 4 }] }, 
        options: horizOptions 
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
    tbody.querySelectorAll('.btn-print-history').forEach(btn => btn.addEventListener('click', (e) => printRncById(e.currentTarget.dataset.id)));
}

function getFilterDates() {
    const iStart = document.getElementById('dash-filter-start'); 
    const iEnd = document.getElementById('dash-filter-end');
    
    let start = iStart.value ? new Date(iStart.value + 'T00:00:00') : new Date(new Date().setDate(1));
    let end = iEnd.value ? new Date(iEnd.value + 'T23:59:59') : new Date();
    
    return { start, end };
}