/**
 * ARQUIVO: js/modules/agendamento.js
 * DESCRIÇÃO: Processamento 100% Local (Zero Firebase) de planilhas de Agendamento.
 */

import { safeBind, showToast } from '../utils.js';

// Lista exata de campos solicitados
const CAMPOS_MODELO = [
    'Nº DO PEDIDO', 'Nome fornecedor', 'CD', 'Nota Fiscal', 'Série', 
    'Data Emissão', 'Itens por NF', 'Qtd Volume', 'Peso Total NF', 
    'Valor Total NF', 'Tipo Agendamento', 'Data', 'Palet', 
    'Transportadora', 'Remessa'
];

let SheetJSLib = null;

// Carrega a biblioteca pesada apenas sob demanda (Mantém o App rápido)
async function loadSheetJS() {
    if (SheetJSLib) return SheetJSLib;
    try {
        const script = document.createElement('script');
        script.src = "https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js";
        document.head.appendChild(script);
        
        // Aguarda o script carregar
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = reject;
        });
        
        SheetJSLib = window.XLSX;
        return SheetJSLib;
    } catch (e) {
        showToast("Erro ao carregar módulo do Excel.", "error");
        console.error(e);
        return null;
    }
}

export function initAgendamentoModule() {
    console.log("Módulo de Agendamento Iniciado (Modo Local).");

    safeBind('btn-download-modelo', 'click', handleDownloadModelo);
    safeBind('input-upload-excel', 'change', handleUploadExcel);
    safeBind('btn-imprimir-capa', 'click', () => window.print());
}

async function handleDownloadModelo() {
    const btn = document.getElementById('btn-download-modelo');
    const txtOriginal = btn.innerHTML;
    btn.innerHTML = 'Gerando...';
    btn.disabled = true;

    const XLSX = await loadSheetJS();
    if (!XLSX) return;

    // Cria a planilha com a linha de cabeçalho
    const ws = XLSX.utils.aoa_to_sheet([CAMPOS_MODELO]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Agendamento");

    // Força o download
    XLSX.writeFile(wb, "Modelo_Capa_Agendamento.xlsx");

    btn.innerHTML = txtOriginal;
    btn.disabled = false;
    showToast("Modelo baixado com sucesso!", "success");
}

async function handleUploadExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast("Lendo arquivo...", "info");

    const XLSX = await loadSheetJS();
    if (!XLSX) {
        event.target.value = ''; // Limpa o input
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            
            // Pega a primeira aba
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Converte para JSON (Array de Objetos)
            const json = XLSX.utils.sheet_to_json(worksheet);
            
            if (json.length === 0) {
                showToast("A planilha está vazia.", "warning");
                return;
            }

            // Pega a primeira linha de dados (linha 2 do Excel)
            const dados = json[0];
            preencherCapa(dados);
            showToast("Capa preenchida com sucesso!", "success");

        } catch (err) {
            console.error(err);
            showToast("Erro ao ler o arquivo Excel.", "error");
        } finally {
            event.target.value = ''; // Limpa para permitir subir o mesmo arquivo de novo
        }
    };
    reader.readAsArrayBuffer(file);
}

// Mapeia os dados do JSON (cabeçalhos do Excel) para os IDs do HTML
function preencherCapa(dados) {
    const mapCampos = {
        'Nome fornecedor': 'capa-fornecedor',
        'Transportadora': 'capa-transportadora',
        'Nº DO PEDIDO': 'capa-pedido',
        'CD': 'capa-cd',
        'Nota Fiscal': 'capa-nf',
        'Série': 'capa-serie',
        'Data Emissão': 'capa-emissao',
        'Data': 'capa-data',
        'Tipo Agendamento': 'capa-tipo',
        'Remessa': 'capa-remessa',
        'Itens por NF': 'capa-itens',
        'Qtd Volume': 'capa-volume',
        'Peso Total NF': 'capa-peso',
        'Palet': 'capa-palet',
        'Valor Total NF': 'capa-valor'
    };

    for (const [colunaExcel, idHtml] of Object.entries(mapCampos)) {
        const elemento = document.getElementById(idHtml);
        if (elemento) {
            // Pega o dado. Se não existir, coloca um "-"
            let valor = dados[colunaExcel];
            
            // Tratamento especial para datas do Excel (que vem como números as vezes)
            if (colunaExcel.includes('Data') && typeof valor === 'number') {
               // Converte data serial do Excel para formato BR
               const date = new Date((valor - (25567 + 1)) * 86400 * 1000);
               valor = date.toLocaleDateString('pt-BR');
            }
            
            // Tratamento especial para Valor Financeiro
            if (colunaExcel === 'Valor Total NF' && typeof valor === 'number') {
                valor = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            }

            elemento.innerText = valor || '-';
        }
    }
}