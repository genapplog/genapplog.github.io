/**
 * ARQUIVO: js/modules/agendamento.js
 * DESCRIÇÃO: Consolidador de Agendamentos Genomma/Inovalab.
 * FUNCIONALIDADES: Multi-Seleção UF, Consolidação e Persistência de Dados Manuais.
 */

import { safeBind, showToast } from '../utils.js';
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { PATHS } from '../config.js';

let SheetJSLib = null;
let ExcelJSLib = null; // ✅ Nova biblioteca para estilizar planilhas
let FileSaverLib = null;

let uploadedData = [];
let currentFilteredData = [];

const UFS_BRASIL = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// Carrega leitor de Excel
async function loadSheetJS() {
    if (SheetJSLib) return SheetJSLib;
    try {
        const script = document.createElement('script');
        script.src = "https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js";
        document.head.appendChild(script);
        await new Promise(res => script.onload = res);
        SheetJSLib = window.XLSX;
        return SheetJSLib;
    } catch (e) { return null; }
}

// ✅ CARREGA EXPORTADOR COM ESTILO (EXCELJS)
async function loadExcelJS() {
    if (ExcelJSLib && FileSaverLib) return true;
    try {
        const scriptExcel = document.createElement('script');
        scriptExcel.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js";
        document.head.appendChild(scriptExcel);

        const scriptSaver = document.createElement('script');
        scriptSaver.src = "https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js";
        document.head.appendChild(scriptSaver);

        await Promise.all([
            new Promise(res => scriptExcel.onload = res),
            new Promise(res => scriptSaver.onload = res)
        ]);
        
        ExcelJSLib = window.ExcelJS;
        FileSaverLib = window.saveAs;
        return true;
    } catch (e) {
        showToast("Erro ao carregar módulos de formatação Excel.", "error");
        return false;
    }
}

export function initAgendamentoModule(db) {
    console.log("Módulo Consolidador de Agendamento Iniciado.");

    setupUFMultiSelect(); 
    safeBind('input-upload-excel', 'change', handleUploadExcel);
    safeBind('btn-exportar-filtrado', 'click', handleExportarFiltrado);
    safeBind('btn-imprimir-capa', 'click', handleImprimirCapa);

    // ✅ BOTÃO SALVAR COM FEEDBACK VISUAL
    safeBind('btn-salvar-capa', 'click', () => {
        const data = document.getElementById('capa-data')?.value;
        const tipo = document.getElementById('capa-tipo')?.value;
        const palet = document.getElementById('capa-palet')?.value;
        
        if(!data && !tipo && !palet) {
            return showToast("Preencha a Data, Tipo ou Qtd Pallets antes de salvar.", "warning");
        }

        const btn = document.getElementById('btn-salvar-capa');
        const originalText = btn.innerHTML;
        
        // Fica Verde
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> SALVO!`;
        btn.classList.replace('bg-blue-600', 'bg-emerald-600');
        btn.classList.replace('hover:bg-blue-500', 'hover:bg-emerald-500');
        
        // Volta ao normal após 2 segundos, mas os dados já estão fixados no HTML
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.replace('bg-emerald-600', 'bg-blue-600');
            btn.classList.replace('hover:bg-emerald-500', 'hover:bg-blue-500');
        }, 2000);

        showToast("Informações fixadas na capa prontas para exportar!", "success");
    });

    if (db) listenToFilters(db);
}

function setupUFMultiSelect() {
    const container = document.getElementById('container-checkbox-uf');
    const btnDropdown = document.getElementById('btn-dropdown-uf');
    const content = document.getElementById('dropdown-uf-content');
    const label = document.getElementById('label-uf-selecionadas');

    if (!container) return;

    UFS_BRASIL.forEach(uf => {
        const labelEl = document.createElement('label');
        labelEl.className = "flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer hover:bg-slate-800 p-1.5 rounded transition-colors";
        labelEl.innerHTML = `<input type="checkbox" value="${uf}" class="uf-checkbox w-3 h-3 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"> ${uf}`;
        container.appendChild(labelEl);
    });

    btnDropdown.onclick = (e) => { e.stopPropagation(); content.classList.toggle('hidden'); };
    document.addEventListener('click', () => content.classList.add('hidden'));
    content.onclick = (e) => e.stopPropagation();

    safeBind('btn-uf-todos', 'click', () => {
        document.querySelectorAll('.uf-checkbox').forEach(cb => cb.checked = true);
        updateUFLabel();
        processarFiltros();
    });

    safeBind('btn-uf-limpar', 'click', () => {
        document.querySelectorAll('.uf-checkbox').forEach(cb => cb.checked = false);
        updateUFLabel();
        processarFiltros();
    });

    container.addEventListener('change', () => {
        updateUFLabel();
        processarFiltros();
    });

    function updateUFLabel() {
        const selecionadas = Array.from(document.querySelectorAll('.uf-checkbox:checked')).map(cb => cb.value);
        if (selecionadas.length === 0) label.innerText = "Nenhuma";
        else if (selecionadas.length === 27) label.innerText = "Todas";
        else label.innerText = `${selecionadas.length} Selecionadas`;
    }
}

function processarFiltros() {
    // ✅ Converte a digitação para maiúsculo na hora de buscar
    const cliente = document.getElementById('capa-cliente-select')?.value?.toUpperCase();
    const inicio = document.getElementById('filtro-emissao-inicio')?.value;
    const fim = document.getElementById('filtro-emissao-fim')?.value;
    const ufsSelecionadas = Array.from(document.querySelectorAll('.uf-checkbox:checked')).map(cb => cb.value);

    if (uploadedData.length === 0 || !cliente || ufsSelecionadas.length === 0 || !inicio || !fim) {
        atualizarCapa([]);
        currentFilteredData = [];
        return [];
    }

    const filtrados = uploadedData.filter(row => {
        const nomePlanilha = String(row['CLIENTE'] || "").toUpperCase();
        const matchCliente = nomePlanilha.includes(cliente);
        const ufNota = String(row['UF DESTINO'] || "").toUpperCase();
        const matchUF = ufsSelecionadas.includes(ufNota);
        
        let dataNF = row['DATA EMISSÃO'];
        if (typeof dataNF === 'number') {
            const date = new Date((dataNF - (25567 + 1)) * 86400 * 1000);
            dataNF = date.toISOString().split('T')[0];
        } else if (typeof dataNF === 'string' && dataNF.includes('/')) {
            const p = dataNF.split('/');
            dataNF = `${p[2]}-${p[1]}-${p[0]}`;
        }

        return matchCliente && matchUF && (dataNF >= inicio && dataNF <= fim);
    });

    currentFilteredData = filtrados; // ✅ Salva na memória
    atualizarCapa(filtrados);
    return filtrados;
}

function atualizarCapa(lista) {
    const campos = {
        nf: document.getElementById('capa-nf'),
        pedido: document.getElementById('capa-pedido'),
        itens: document.getElementById('capa-itens'),
        volume: document.getElementById('capa-volume'),
        peso: document.getElementById('capa-peso'),
        valor: document.getElementById('capa-valor'),
        transp: document.getElementById('capa-transportadora'),
        cd: document.getElementById('capa-cd'),
        remessa: document.getElementById('capa-remessa'),
        fornecedor: document.getElementById('capa-fornecedor')
    };

    if (lista.length === 0) {
        Object.values(campos).forEach(el => { 
            // 🚫 NUNCA apaga os dados manuais digitados pelo operador ao esvaziar a lista
            if(el && !['capa-data', 'capa-tipo', 'capa-palet'].includes(el.id)) {
                el.value = ''; 
            }
        });
        return;
    }

    const embarcador = String(lista[0]['EMBARCADOR'] || "").toUpperCase();
    if (campos.fornecedor) {
        if (embarcador.includes('INOVALAB')) campos.fornecedor.value = "INOVALAB DO BRASIL LTDA";
        else campos.fornecedor.value = "GENOMMA LABORATORIES DO BRASIL LTDA";
    }

    const nfs = [...new Set(lista.map(r => r['NRO NF']))].join(', ');
    const pedidos = [...new Set(lista.map(r => r['PEDIDO']))].join(', ');
    const sum = (key) => lista.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

    if(campos.nf) campos.nf.value = nfs;
    if(campos.pedido) campos.pedido.value = pedidos;
    if(campos.itens) campos.itens.value = sum('QUANTIDADE TOTAL DE UNIDADES');
    if(campos.volume) campos.volume.value = sum('QTDE VOLUMES');
    if(campos.peso) campos.peso.value = sum('PESO').toFixed(2);
    if(campos.valor) campos.valor.value = sum('VALOR TOTAL').toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if(campos.transp) campos.transp.value = String(lista[0]['TRANSPORTADOR'] || '').toUpperCase();
    
    // ✅ Agrupa e lista todas as UFs únicas das notas (ex: "SP, RJ, MG")
    const ufsDestino = [...new Set(lista.map(r => String(r['UF DESTINO'] || '').toUpperCase()).filter(Boolean))].join(', ');
    if(campos.cd) campos.cd.value = ufsDestino;
    
    if(campos.remessa) campos.remessa.value = '';
    
    // Os campos capa-data, capa-tipo e capa-palet foram removidos desta função.
    // Eles agora são 100% responsabilidade do operador e não serão mais resetados pelo sistema!
}

async function handleExportarFiltrado() {
    const lista = currentFilteredData; 
    if (lista.length === 0) return showToast("Nenhum dado filtrado para exportar.", "warning");

    const isLoaded = await loadExcelJS();
    if (!isLoaded) return;

    const fornecedor = document.getElementById('capa-fornecedor').value;
    const dataAgenda = document.getElementById('capa-data').value; 
    const tipoAgenda = document.getElementById('capa-tipo').value; 

    // ✅ CRIA PLANILHA E REMOVE LINHAS DE GRADE
    const workbook = new ExcelJSLib.Workbook();
    const worksheet = workbook.addWorksheet('Agendamento', { views: [{ showGridLines: false }] });

    // ✅ DEFINIR LARGURA DAS COLUNAS (Sem usar a propriedade que sobrescreve a linha 1)
    worksheet.getColumn(1).width = 22;  // A: PEDIDO
    worksheet.getColumn(2).width = 45;  // B: FORNECEDOR
    worksheet.getColumn(3).width = 10;  // C: CD
    worksheet.getColumn(4).width = 20;  // D: NF
    worksheet.getColumn(5).width = 10;  // E: SÉRIE
    worksheet.getColumn(6).width = 15;  // F: EMISSÃO
    worksheet.getColumn(7).width = 15;  // G: ITENS
    worksheet.getColumn(8).width = 15;  // H: VOLUME
    worksheet.getColumn(9).width = 18;  // I: PESO
    worksheet.getColumn(10).width = 20; // J: VALOR
    worksheet.getColumn(11).width = 20; // K: TIPO
    worksheet.getColumn(12).width = 15; // L: 1A DATA
    worksheet.getColumn(13).width = 10; // M: PALET
    worksheet.getColumn(14).width = 35; // N: TRANSP
    worksheet.getColumn(15).width = 15; // O: REMESSA

    // ✅ LINHA 1: DATA SUGERIDA (Estilo Escuro AppLog)
    const dataFormatada = dataAgenda ? dataAgenda.toUpperCase() : 'NÃO INFORMADA';
    const row1 = worksheet.addRow([`SOLICITAÇÃO DE AGENDAMENTO - DATA SUGERIDA (${dataFormatada})`]);
    worksheet.mergeCells('A1:O1'); 
    const titulo = worksheet.getCell('A1');
    titulo.font = { name: 'Arial Black', size: 12, color: { argb: 'FFFFFFFF' } }; // Texto Branco
    titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }; // Fundo Slate 800
    titulo.alignment = { vertical: 'middle', horizontal: 'center' };
    row1.height = 30;

    // ✅ LINHA 2: TÍTULOS DAS COLUNAS EM MAIÚSCULO
    const headerRow = worksheet.addRow([
        'Nº DO PEDIDO', 'NOME FORNECEDOR', 'CD', 'NOTA FISCAL', 'SÉRIE', 'DT EMISSÃO', 
        'ITENS POR NF', 'QTD VOLUME', 'PESO TOTAL NF', 'VALOR TOTAL NF', 'TP AGENDAMENTO', 
        '1A DATA', 'PALET', 'TRANSPORTADORA', 'REMESSA'
    ]);
    headerRow.height = 25;
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Arial' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; // Fundo Indigo 600
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { top: {style:'medium'}, left: {style:'medium'}, bottom: {style:'medium'}, right: {style:'medium'} };
    });

    // ✅ INSERE OS DADOS (Com ZEBRA e bordas finas)
    const toUpperStr = (val) => (val !== undefined && val !== null) ? String(val).toUpperCase() : '';

    lista.forEach((r, index) => {
        let dtEmissao = r['DATA EMISSÃO'];
        if (typeof dtEmissao === 'number') dtEmissao = new Date((dtEmissao - (25567 + 1)) * 86400 * 1000).toLocaleDateString('pt-BR');

        let dtAgend = r['DATA AGENDAMENTO'];
        if (typeof dtAgend === 'number') dtAgend = new Date((dtAgend - (25567 + 1)) * 86400 * 1000).toLocaleDateString('pt-BR');

        const row = worksheet.addRow([
            toUpperStr(r['PEDIDO']),
            toUpperStr(fornecedor),
            toUpperStr(r['UF DESTINO']),
            toUpperStr(r['NRO NF']),
            toUpperStr(r['SÉRIE NF']),
            toUpperStr(dtEmissao),
            '', // ITENS POR NF em branco
            toUpperStr(r['QTDE VOLUMES']),
            toUpperStr(r['PESO']),
            toUpperStr(r['VALOR TOTAL']),
            toUpperStr(tipoAgenda),
            toUpperStr(dtAgend),
            'SIM', // PALET fixo
            toUpperStr(r['TRANSPORTADOR']),
            '' // REMESSA em branco
        ]);

        // Formatação das células de dados
        row.eachCell((cell) => {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.font = { name: 'Arial', size: 10 };
            cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
            
            // Efeito Zebra (Cinza clarinho nas linhas alternadas)
            if (index % 2 !== 0) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            }
        });
    });

    // ✅ GERA E BAIXA O ARQUIVO EXCEL
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const cliente = document.getElementById('capa-cliente-select').value || 'GERAL';
    FileSaverLib(blob, `AGENDAMENTO_${cliente}_CONSOLIDADO.xlsx`);
    
    showToast("Planilha AppLog exportada com sucesso!", "success");
}

function handleImprimirCapa() {
    const fornecedor = document.getElementById('capa-fornecedor').value;
    if (!fornecedor || currentFilteredData.length === 0) {
        return showToast("Carregue os dados e selecione os filtros antes de imprimir.", "warning");
    }
    
    const spanData = document.getElementById('span-data-impressao');
    if (spanData) spanData.innerText = new Date().toLocaleString('pt-BR');
    
    const select = document.getElementById('capa-cliente-select');
    const printName = document.getElementById('print-cliente-nome');
    if (printName && select) printName.innerText = select.value || "CLIENTE NÃO SELECIONADO";

    window.print();
}

function listenToFilters(db) {
    // Escuta mudanças nos filtros básicos e no input oculto do cliente
    const ids = ['filtro-emissao-inicio', 'filtro-emissao-fim', 'capa-fornecedor', 'capa-cliente-select'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', processarFiltros);
    });

    // -----------------------------------------------------
    // LÓGICA DO AUTOCOMPLETE (CAIXA ÚNICA)
    // -----------------------------------------------------
    const contentDropdown = document.getElementById('dropdown-cliente-content');
    const searchInput = document.getElementById('search-cliente-input');
    const ulLista = document.getElementById('lista-clientes-ul');
    const inputHidden = document.getElementById('capa-cliente-select');
    
    let clientesCadastrados = [];

    onSnapshot(collection(db, PATHS.clients), (snapshot) => {
        clientesCadastrados = [];
        snapshot.forEach(doc => {
            if (doc.data().name) clientesCadastrados.push(doc.data().name.toUpperCase().trim());
        });
        clientesCadastrados.sort();
        renderizarListaClientes(clientesCadastrados);
    });

    if (searchInput) {
        // Mostra a lista completa ao clicar na caixa
        searchInput.onclick = (e) => {
            e.stopPropagation();
            contentDropdown.classList.remove('hidden');
            
            // Se a caixa estiver vazia, mostra todos. Senão, mostra os que batem com a busca
            const termo = searchInput.value.toUpperCase();
            const filtrados = termo ? clientesCadastrados.filter(c => c.includes(termo)) : clientesCadastrados;
            renderizarListaClientes(filtrados);
        };

        // Filtra enquanto digita e força a lista a aparecer
        searchInput.addEventListener('input', (e) => {
            contentDropdown.classList.remove('hidden');
            const termo = e.target.value.toUpperCase();
            const filtrados = clientesCadastrados.filter(c => c.includes(termo));
            renderizarListaClientes(filtrados);
            
            // Se apagar tudo, reseta a capa
            if(termo === '') {
                inputHidden.value = '';
                inputHidden.dispatchEvent(new Event('change'));
            }
        });
    }

    // Fecha a lista ao clicar fora
    document.addEventListener('click', (e) => {
        if (contentDropdown && !contentDropdown.contains(e.target) && e.target !== searchInput) {
            contentDropdown.classList.add('hidden');
            
            // Proteção: Se fechar clicando fora sem selecionar, volta pro valor válido que estava antes
            if(searchInput && inputHidden) {
                searchInput.value = inputHidden.value;
            }
        }
    });

    function renderizarListaClientes(lista) {
        if (!ulLista) return;
        ulLista.innerHTML = '';
        
        if (lista.length === 0) {
            ulLista.innerHTML = '<li class="p-3 text-slate-500 text-center font-bold">NENHUM CLIENTE ENCONTRADO.</li>';
            return;
        }

        lista.forEach(nome => {
            const li = document.createElement('li');
            li.className = "p-3 hover:bg-indigo-600 text-slate-300 hover:text-white cursor-pointer transition-colors border-b border-slate-800 last:border-0";
            li.textContent = nome;
            
            li.onclick = () => {
                inputHidden.value = nome;
                searchInput.value = nome; // A caixa principal recebe o nome clicado
                contentDropdown.classList.add('hidden');
                
                inputHidden.dispatchEvent(new Event('change')); // Dispara o recálculo
            };
            ulLista.appendChild(li);
        });
    }
}

async function handleUploadExcel(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const XLSX = await loadSheetJS();
    if (!XLSX) return;

    const reader = new FileReader();
    reader.onload = e => {
        try {
            const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
            const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            
            uploadedData = json.map(row => {
                const newRow = {};
                for (let key in row) { 
                    newRow[key.toString().toUpperCase().trim()] = row[key]; 
                }
                return newRow;
            });
            showToast(`${uploadedData.length} registros carregados da planilha bruta.`, "success");
            processarFiltros(); 
        } catch (err) {
            showToast("Erro ao processar arquivo.", "error");
        }
    };
    reader.readAsArrayBuffer(file);
}