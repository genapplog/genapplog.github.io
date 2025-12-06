/**
 * ARQUIVO: js/modules/dashboard.js
 * DESCRIÇÃO: Lógica de Gráficos, KPIs, Tabela de Histórico e Exportação Excel.
 */
import { safeBind, showToast, printDocument } from '../utils.js';

// Variáveis locais para controle dos gráficos e dados
let localAllData = [];
let chartTypeInstance = null;
let chartLocalInstance = null;
let chartCausadorInstance = null;
let chartIdentificadorInstance = null;

// Inicializa os ouvintes dos botões do Dashboard (Filtros e Exportar)
export function initDashboard() {
    console.log("Iniciando Módulo Dashboard...");

    // Filtros de Data
    safeBind('btn-dash-filter-apply', 'click', () => applyDashboardFilters());
    safeBind('btn-dash-filter-clear', 'click', () => { 
        const i1 = document.getElementById('dash-filter-start');
        const i2 = document.getElementById('dash-filter-end');
        if(i1) i1.value = ''; if(i2) i2.value = '';
        applyDashboardFilters(); 
    });

    // Exportação
    safeBind('btn-dash-export', 'click', exportToXlsx);
    safeBind('btn-dash-export-pallet', 'click', exportPalletReqToXlsx);
    
    // Busca na tabela de histórico
    safeBind('history-search-input', 'input', () => renderHistoryTable());
    safeBind('history-search-clear', 'click', () => { 
        const i = document.getElementById('history-search-input'); 
        if(i){ i.value=''; renderHistoryTable(); } 
    });
}

// Função principal chamada pelo rnc.js quando chegam dados novos do banco
export function updateDashboardView(allData) {
    localAllData = allData; // Guarda os dados na memória deste módulo
    applyDashboardFilters(); // Aplica filtros e desenha gráficos
}

// --- LÓGICA DE FILTROS E GRÁFICOS ---

function applyDashboardFilters() {
    const iStart = document.getElementById('dash-filter-start'); 
    const iEnd = document.getElementById('dash-filter-end');
    
    // Se não estiver na tela, para (evita erros)
    if(!iStart || !iEnd) return;

    const startVal = iStart.value; 
    const endVal = iEnd.value;
    let startDate = startVal ? new Date(startVal + 'T00:00:00') : null; 
    let endDate = endVal ? new Date(endVal + 'T23:59:59') : null;
    
    // 1. Separa o que é RNC do que é Etiqueta (Dashboard foca em RNC)
    // E AGORA: Filtra apenas os CONCLUÍDOS (Finalizados todas as etapas)
    const onlyRNC = localAllData.filter(d => d.type !== 'pallet_label_request' && d.status === 'concluido');

    // 2. Aplica filtro de data
    const filteredRNC = onlyRNC.filter(d => { 
        if(startDate && d.jsDate < startDate) return false; 
        if(endDate && d.jsDate > endDate) return false; 
        return true; 
    });
    
    updateChartsAndStats(filteredRNC);
    renderHistoryTable(filteredRNC);
}

function updateChartsAndStats(data) {
    let total = data.length; 
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

    // Atualiza KPIs (Cards)
    const elTotal = document.getElementById('dash-total-oc'); 
    if(elTotal) elTotal.innerText = total; 
    
    const elDate = document.getElementById('dash-last-date');
    if(elDate) elDate.innerText = (total > 0 && data[0].jsDate) ? data[0].jsDate.toLocaleDateString('pt-BR') : "-";
    
    let maxType = "-", maxVal = -1; 
    for(const [k, v] of Object.entries(types)) if(v > maxVal && v > 0) { maxVal = v; maxType = k; }
    const elType = document.getElementById('dash-top-type');
    if(elType) elType.innerText = maxType;

    // Função Helper para Gráficos
    const createOrUpdateChart = (canvasId, config, currentInstance) => { 
        const ctx = document.getElementById(canvasId); 
        if (!ctx) return null; 
        if (currentInstance) currentInstance.destroy(); 
        return new Chart(ctx, config); 
    };

    // 1. GRÁFICO DE ROSCA (AJUSTADO PARA LEGENDA EM LINHA)
    chartTypeInstance = createOrUpdateChart('chartOcType', { 
        type: 'doughnut', 
        data: { 
            labels: ['Falta', 'Sobra', 'Avaria', 'Falta Interna'], 
            datasets: [{ 
                data: [types.FALTA, types.SOBRA, types.AVARIA, types.FALTA_INTERNA], 
                backgroundColor: ['#ef4444', '#3b82f6', '#f59e0b', '#a855f7'], 
                borderWidth: 0, 
                borderRadius: 4 
            }] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false, // Permite ajustar melhor ao container
            plugins: { 
                legend: { 
                    display: true, 
                    position: 'bottom', // Fica embaixo
                    labels: { 
                        color: '#cbd5e1',
                        usePointStyle: true, // Usa bolinhas (ocupa menos espaço)
                        boxWidth: 8,         // Tamanho da bolinha
                        padding: 20,         // Espaço entre itens
                        font: { size: 11 }
                    } 
                } 
            },
            layout: {
                padding: { bottom: 10 }
            }
        } 
    }, chartTypeInstance);
    
    // 2. GRÁFICO DE BARRAS (LOCAIS)
    chartLocalInstance = createOrUpdateChart('chartOcLocal', { 
        type: 'bar', 
        data: { 
            labels: ['Armazenagem', 'Estoque', 'Checkout', 'Separação'], 
            datasets: [{ 
                label: 'Qtd', 
                data: [locals.ARMAZENAGEM, locals.ESTOQUE, locals.CHECKOUT, locals.SEPARAÇÃO], 
                backgroundColor: '#6366f1', 
                borderWidth: 0, 
                borderRadius: 4 
            }] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }, 
            scales: { 
                y: { beginAtZero: true, grid: { color: '#334155' }, ticks: { color: '#cbd5e1' } }, 
                x: { grid: { display: false }, ticks: { color: '#cbd5e1' } } 
            } 
        } 
    }, chartLocalInstance);
    
    // 3. TOP CAUSADORES
    const sortObj = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const sCaus = sortObj(causadores); 
    chartCausadorInstance = createOrUpdateChart('chartOcCausador', { 
        type: 'bar', 
        data: { 
            labels: sCaus.map(i=>i[0]), 
            datasets: [{ 
                data: sCaus.map(i=>i[1]), 
                backgroundColor: '#f43f5e', 
                borderRadius: 4, 
                barThickness: 20 
            }] 
        }, 
        options: { 
            indexAxis: 'y', 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }, 
            scales: { 
                x: { beginAtZero: true, grid: { color: '#334155' }, ticks: { color: '#cbd5e1', stepSize: 1 } }, 
                y: { grid: { display: false }, ticks: { color: '#cbd5e1', font: { size: 10 } } } 
            } 
        } 
    }, chartCausadorInstance);
    
    // 4. TOP IDENTIFICADORES
    const sIdent = sortObj(identificadores); 
    chartIdentificadorInstance = createOrUpdateChart('chartOcIdentificador', { 
        type: 'bar', 
        data: { 
            labels: sIdent.map(i=>i[0]), 
            datasets: [{ 
                data: sIdent.map(i=>i[1]), 
                backgroundColor: '#10b981', 
                borderRadius: 4, 
                barThickness: 20 
            }] 
        }, 
        options: { 
            indexAxis: 'y', 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }, 
            scales: { 
                x: { beginAtZero: true, grid: { color: '#334155' }, ticks: { color: '#cbd5e1', stepSize: 1 } }, 
                y: { grid: { display: false }, ticks: { color: '#cbd5e1', font: { size: 10 } } } 
            } 
        } 
    }, chartIdentificadorInstance);
}

function renderHistoryTable(dataToRender) {
    const tbody = document.getElementById('history-list-tbody'); 
    const searchInput = document.getElementById('history-search-input'); 
    const clearBtn = document.getElementById('history-search-clear'); 
    
    if (!tbody) return;

    // Se a função foi chamada pelo input de busca, usa localAllData filtrado, senão usa o que veio do filtro de data
    // Filtra apenas CONCLUÍDOS também na busca global
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
    
    // ALTERADO DE 5 PARA 10 AQUI
    const finalLimit = searchTerm ? list.length : 10; 
    const truncatedList = list.slice(0, finalLimit);
    
    truncatedList.forEach(item => {
        const tr = document.createElement('tr'); 
        tr.className = "border-b border-slate-700 hover:bg-slate-750 transition-colors";
        const displayNF = item.nf ? item.nf : '-';
        
        // Lógica visual para status
        let statusDot = '';
        if (item.status === 'concluido') statusDot = '<span class="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>';
        else statusDot = '<span class="inline-block w-2 h-2 rounded-full bg-amber-500 mr-2"></span>';

        tr.innerHTML = `
            <td class="px-4 py-3 font-mono text-slate-300 text-xs">
                ${statusDot}${item.jsDate.toLocaleDateString('pt-BR')}
            </td>
            <td class="px-4 py-3 text-white font-medium text-sm">
                ${item.embarque || '-'}<br>
                <span class="text-slate-500 text-[10px] font-normal">${displayNF}</span>
            </td>
            <td class="px-4 py-3 text-slate-300 text-xs">${item.tipo}</td>
            <td class="px-4 py-3 text-right">
                <button class="text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded transition btn-print-history flex items-center gap-2 ml-auto text-xs" data-id="${item.id}">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                    Imprimir
                </button>
            </td>`;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-print-history').forEach(btn => btn.addEventListener('click', (e) => printRncReport(e.currentTarget.dataset.id)));
}

// --- EXPORTAÇÃO EXCEL ---

function exportToXlsx() {
    const iStart = document.getElementById('dash-filter-start'); 
    const iEnd = document.getElementById('dash-filter-end');

    // LÓGICA DE DATA PADRÃO (Últimos 30 dias se vazio)
    let startDate, endDate;
    const isDefaultFilter = !iStart.value && !iEnd.value; // Flag para aviso visual

    if (iStart.value) {
        startDate = new Date(iStart.value + 'T00:00:00');
    } else {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30); // Volta 30 dias
        startDate.setHours(0,0,0,0);
    }

    if (iEnd.value) {
        endDate = new Date(iEnd.value + 'T23:59:59');
    } else {
        endDate = new Date(); // Hoje
        endDate.setHours(23,59,59,999);
    }

    // Filtra Etiquetas E itens não concluídos
    const data = localAllData.filter(d => d.type !== 'pallet_label_request' && d.status === 'concluido').filter(d => { 
        if(d.jsDate < startDate) return false; 
        if(d.jsDate > endDate) return false; 
        return true; 
    });

    if (data.length === 0) { showToast("Nenhum dado RD no período.", "info"); return; }
    
    if (isDefaultFilter) showToast("Exportando últimos 30 dias (Padrão)", "info");

    const exportData = data.map(d => {
        let detalhesEmb = [];
        if(d.emb_amassada) detalhesEmb.push("Amassada");
        if(d.emb_rasgada) detalhesEmb.push("Rasgada");
        if(d.emb_vazamento) detalhesEmb.push("Vazamento");
        if(d.emb_outros) detalhesEmb.push(d.emb_outros);
        const tipoDetalhado = detalhesEmb.length > 0 ? detalhesEmb.join(", ") : "-";
        return {
            "DATA": d.jsDate.toLocaleDateString('pt-BR'), "MÊS": d.jsDate.toLocaleString('pt-BR', { month: 'long' }).toUpperCase(), "ANO": d.jsDate.getFullYear(),
            "ORIGEM / RESPONSÁVEL": d.infrator || '-', "IDENTIFICADOR": d.ass_colab || '-', "LOCAL": d.local || '-', "OCORRENCIA": d.tipo || '-', "TIPO OCORRENCIA": tipoDetalhado,
            "EMBARQUE": d.embarque || '-', "CLIENTE": d.nf || '-', "CÓDIGO": d.item_cod || '-', "DESCRIÇÃO DO ITEM": d.item_desc || '-', "LOTE": d.item_lote || '-', "QTD (CX)": d.item_qtd || '0', "ENDEREÇO": d.item_end || '-', "LIDER": d.ass_lider || '-', "INVENTÁRIO": d.ass_inv || '-', "OBSERVAÇÕES": d.obs || '-'
        };
    });
    
    generateXlsx(exportData, "Relatorio_RD");
}

function exportPalletReqToXlsx() {
    const iStart = document.getElementById('dash-filter-start'); 
    const iEnd = document.getElementById('dash-filter-end');

    // LÓGICA DE DATA PADRÃO (Últimos 30 dias se vazio)
    let startDate, endDate;
    const isDefaultFilter = !iStart.value && !iEnd.value;

    if (iStart.value) {
        startDate = new Date(iStart.value + 'T00:00:00');
    } else {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        startDate.setHours(0,0,0,0);
    }

    if (iEnd.value) {
        endDate = new Date(iEnd.value + 'T23:59:59');
    } else {
        endDate = new Date();
        endDate.setHours(23,59,59,999);
    }

    // Só traz etiquetas do tipo pallet_label_request QUE ESTEJAM CONCLUÍDAS
    const data = localAllData.filter(d => d.type === 'pallet_label_request' && d.status === 'concluido').filter(d => { 
        if(d.jsDate < startDate) return false; 
        if(d.jsDate > endDate) return false; 
        return true; 
    });

    if (data.length === 0) { showToast("Nenhuma etiqueta concluída no período.", "info"); return; }

    if (isDefaultFilter) showToast("Exportando últimos 30 dias (Padrão)", "info");
    
    const exportData = data.map(d => {
        return {
            "Item / Código": d.item || '-',
            "Lote": d.lote || '-',
            "Quantidade": d.qtd || 0,
            "Data Solicitação": d.jsDate ? d.jsDate.toLocaleDateString('pt-BR') + ' ' + d.jsDate.toLocaleTimeString('pt-BR') : '-',
            "Status": "CONCLUÍDO"
        };
    });
    
    generateXlsx(exportData, "Etiquetas_Palete_Concluidas", [{wch: 50}, {wch: 20}, {wch: 15}, {wch: 20}, {wch: 15}]);
}

function generateXlsx(data, sheetName, cols) {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    if(cols) ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const fileName = `${sheetName}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
}

// Exporta para ser usada tanto aqui (botão histórico) quanto no admin (rnc.js)
export function printRncReport(id) {
    const item = localAllData.find(d => d.id === id);
    if (!item) return showToast("Erro ao carregar dados.", "error");

    const checkIcon = `<svg class="w-4 h-4 text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    const emptyIcon = `<span class="w-4 h-4 inline-block border border-slate-300 rounded mr-1"></span>`;
    const check = (val) => val ? `<div class="flex items-center gap-1 font-bold text-slate-800">${checkIcon} SIM</div>` : `<div class="flex items-center gap-1 text-slate-400">${emptyIcon} NÃO</div>`;
    
    // Cores do Status para Impressão (Bordas)
    const statusColor = item.status === 'concluido' ? 'border-emerald-600' : 'border-amber-500';
    const statusText = item.status === 'concluido' ? 'CONCLUÍDO' : 'PENDENTE';
    const statusBg = item.status === 'concluido' ? 'bg-emerald-600' : 'bg-amber-500';

    const content = `
        <div class="flex justify-between items-start mb-6 border-b-2 ${statusColor} pb-4">
            <div>
                <h1 class="text-3xl font-black text-slate-800 uppercase tracking-tighter">Relatório de Divergência</h1>
                <p class="text-sm text-slate-500 font-mono mt-1">ID: ${item.id.toUpperCase()}</p>
            </div>
            <div class="text-right">
                <span class="${statusBg} text-white px-3 py-1 rounded text-xs font-bold uppercase tracking-wider">${statusText}</span>
                <p class="text-xs text-slate-400 mt-2">Data Emissão: ${new Date().toLocaleDateString('pt-BR')}</p>
            </div>
        </div>

        <div class="grid grid-cols-4 gap-4 mb-6">
            <div class="col-span-1 bg-slate-50 p-3 rounded border border-slate-200">
                <p class="text-[9px] font-bold text-slate-400 uppercase">Data Ocorrência</p>
                <p class="text-lg font-bold text-slate-800">${item.jsDate.toLocaleDateString('pt-BR')}</p>
            </div>
            <div class="col-span-1 bg-slate-50 p-3 rounded border border-slate-200">
                <p class="text-[9px] font-bold text-slate-400 uppercase">Tipo</p>
                <p class="text-lg font-bold text-slate-800">${item.tipo}</p>
            </div>
            <div class="col-span-1 bg-slate-50 p-3 rounded border border-slate-200">
                <p class="text-[9px] font-bold text-slate-400 uppercase">Local</p>
                <p class="text-lg font-bold text-slate-800">${item.local}</p>
            </div>
             <div class="col-span-1 bg-slate-50 p-3 rounded border border-slate-200">
                <p class="text-[9px] font-bold text-slate-400 uppercase">Origem/Infrator</p>
                <p class="text-sm font-bold text-slate-800 truncate">${item.infrator || 'N/A'}</p>
            </div>
        </div>

        <div class="mb-6 border border-slate-200 rounded-lg overflow-hidden">
            <div class="bg-slate-100 px-4 py-2 border-b border-slate-200 flex justify-between">
                <span class="text-xs font-bold text-slate-600 uppercase">Dados Logísticos & Produto</span>
            </div>
            <div class="p-4 grid grid-cols-2 gap-y-4 gap-x-8">
                <div>
                    <span class="block text-[10px] text-slate-400 uppercase">Embarque</span>
                    <span class="block font-mono font-bold text-slate-700 text-lg">${item.embarque || '-'}</span>
                </div>
                <div>
                    <span class="block text-[10px] text-slate-400 uppercase">Nota Fiscal / Cliente</span>
                    <span class="block font-mono font-bold text-slate-700 text-lg">${item.nf || '-'}</span>
                </div>
                <div class="col-span-2 border-t border-slate-100 pt-2"></div>
                <div class="col-span-2">
                    <span class="block text-[10px] text-slate-400 uppercase">Produto Afetado</span>
                    <span class="block font-bold text-slate-800 text-xl">${item.item_cod || '?'} - ${item.item_desc || '(Sem descrição)'}</span>
                </div>
                <div>
                    <span class="block text-[10px] text-slate-400 uppercase">Lote</span>
                    <span class="block font-mono text-slate-700">${item.item_lote || '-'}</span>
                </div>
                <div>
                    <span class="block text-[10px] text-slate-400 uppercase">Quantidade (Caixas)</span>
                    <span class="block font-mono font-bold text-red-600 text-xl">${item.item_qtd || '0'}</span>
                </div>
            </div>
        </div>

        <div class="mb-6">
            <h3 class="text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Estado da Embalagem</h3>
            <div class="flex gap-4 border border-slate-200 rounded p-3 bg-white">
                <div class="flex-1">${check(item.emb_amassada)} <span class="text-xs ml-5">Amassada</span></div>
                <div class="flex-1">${check(item.emb_rasgada)} <span class="text-xs ml-5">Rasgada</span></div>
                <div class="flex-1">${check(item.emb_vazamento)} <span class="text-xs ml-5">Vazamento</span></div>
            </div>
            ${item.emb_outros ? `<div class="mt-2 text-xs text-slate-500 italic bg-slate-50 p-2 rounded border border-slate-100">Obs: ${item.emb_outros}</div>` : ''}
        </div>

        <div class="mb-8">
            <h3 class="text-[10px] font-bold text-slate-400 uppercase mb-2 ml-1">Relato Técnico / Observações</h3>
            <div class="w-full p-4 border border-slate-300 rounded bg-slate-50 min-h-[100px] text-sm text-slate-700 leading-relaxed">
                ${item.obs || 'Nenhuma observação registrada.'}
            </div>
        </div>

        <div class="mt-auto pt-4 border-t-2 border-slate-800">
            <div class="grid grid-cols-3 gap-8 text-center">
                <div>
                    <div class="h-10 flex items-end justify-center pb-1"><span class="font-bold text-slate-800 text-sm">${item.ass_colab || '-'}</span></div>
                    <div class="border-t border-slate-400 pt-1 text-[9px] uppercase font-bold text-slate-500">Reportado Por</div>
                </div>
                <div>
                    <div class="h-10 flex items-end justify-center pb-1"><span class="font-bold text-slate-800 text-sm">${item.ass_lider || ''}</span></div>
                    <div class="border-t border-slate-400 pt-1 text-[9px] uppercase font-bold text-slate-500">Liderança</div>
                </div>
                <div>
                    <div class="h-10 flex items-end justify-center pb-1"><span class="font-bold text-slate-800 text-sm">${item.ass_inv || ''}</span></div>
                    <div class="border-t border-slate-400 pt-1 text-[9px] uppercase font-bold text-slate-500">Inventário</div>
                </div>
            </div>
        </div>
    `;
   // Monta o nome do arquivo apenas com os dados que existem
    let titleParts = ['RD'];

    if (item.embarque) titleParts.push(item.embarque);
    if (item.nf) titleParts.push(item.nf);

    // Se não tiver nem Embarque nem NF (ex: avaria interna sem dono identificado), usa o ID
    if (titleParts.length === 1) {
        titleParts.push('INTERNO'); // Ou use item.id.substring(0,5) se preferir
        titleParts.push(item.id.substring(0,5).toUpperCase());
    }

    const docTitle = titleParts.join('-');
    
    printDocument(docTitle, content);
}