/**
 * ARQUIVO: js/modules/labels.js
 * DESCRIÇÃO: Gerador de ZPL e Integração com API Labelary.
 */
import { safeBind, showToast } from '../utils.js';
import { LABEL_DIMENSIONS, CD_DATA } from './labels-data.js';
import { getAmazonTemplate, getManualTemplate } from './zpl-templates.js';
import { fetchLabelPreview, fetchLabelPdf } from '../services/labelary.js';

export function initLabelsModule() {
    console.log("Iniciando Módulo de Etiquetas...");

    // Navegação
    safeBind('btn-open-amazon', 'click', () => { document.getElementById('zpl-menu').classList.add('hidden'); document.getElementById('zpl-tool-amazon').classList.remove('hidden'); });
    safeBind('btn-back-zpl', 'click', () => { document.getElementById('zpl-tool-amazon').classList.add('hidden'); document.getElementById('zpl-menu').classList.remove('hidden'); });
    safeBind('btn-open-manual', 'click', () => { document.getElementById('zpl-menu').classList.add('hidden'); document.getElementById('zpl-tool-manual').classList.remove('hidden'); });
    safeBind('btn-back-zpl-manual', 'click', () => { document.getElementById('zpl-tool-manual').classList.add('hidden'); document.getElementById('zpl-menu').classList.remove('hidden'); });

    // Toggle Código
    safeBind('btn-toggle-zpl-amazon', 'click', () => document.getElementById('box-zpl-amazon').classList.toggle('hidden'));
    safeBind('btn-toggle-zpl-manual', 'click', () => document.getElementById('box-zpl-manual').classList.toggle('hidden'));

    // Limpeza Automática Chave NF
    const inputNf = document.getElementById('inputChaveNf');
    if (inputNf) {
        inputNf.removeAttribute('maxlength'); 
        inputNf.addEventListener('input', (e) => {
            let cleanValue = e.target.value.replace(/\D/g, '');
            if (cleanValue.length > 44) cleanValue = cleanValue.substring(0, 44);
            e.target.value = cleanValue;
        });
    }

    // Auto-preenchimento
    safeBind('inputQuantidadeTotal', 'input', (e) => { document.getElementById('inputCaixaFinal').value = e.target.value; });
    safeBind('inputManualQtdTotal', 'input', (e) => { document.getElementById('inputManualCaixaFim').value = e.target.value; });

    // Ações
    safeBind('generateButton', 'click', async () => handleGenerateAmazon());
    safeBind('generateButtonManual', 'click', async () => handleGenerateManual());
    
    safeBind('printButton', 'click', async () => handlePrintPDF('zplCode', 'selectTamanho', 'printButton'));
    safeBind('printButtonManual', 'click', async () => handlePrintPDF('zplCodeManual', null, 'printButtonManual', '4x3.15'));
}

async function handleGenerateAmazon() {
    // ... (o resto da função permanece igual)
    const btn = document.getElementById('generateButton');
    const btnPrint = document.getElementById('printButton');
    const preview = document.getElementById('previewContainer');
    const zplArea = document.getElementById('zplCode');
    
    const sizeKey = document.getElementById('selectTamanho').value;
    const dimensionConfig = LABEL_DIMENSIONS[sizeKey];
    const cdCode = document.getElementById('selectCdAmazon').value;
    const cdInfo = CD_DATA[cdCode];
    const nfKey = document.getElementById('inputChaveNf').value;
    const poNumber = document.getElementById('inputPedido').value;
    
    const totalQty = parseInt(document.getElementById('inputQuantidadeTotal').value);
    const boxStart = parseInt(document.getElementById('inputCaixaInicial').value);
    const boxEnd = parseInt(document.getElementById('inputCaixaFinal').value);

    if (!cdInfo) { showToast("CD inválido", 'error'); return; }
    if (isNaN(boxStart) || isNaN(boxEnd) || isNaN(totalQty)) { showToast("Preencha números válidos", 'error'); return; }

    let fullZplBatch = ""; 
    for (let i = boxStart; i <= boxEnd; i++) {
        fullZplBatch += getAmazonTemplate(dimensionConfig, cdCode, cdInfo, nfKey, poNumber, i, totalQty);
    }
    zplArea.value = fullZplBatch;

    const previewZpl = getAmazonTemplate(dimensionConfig, cdCode, cdInfo, nfKey, poNumber, boxStart, totalQty);
    
    fetchPreview(sizeKey, previewZpl, btn, btnPrint, preview, 'Gerar Etiqueta', true);
    
    if(boxEnd > boxStart) showToast(`Lote de ${boxEnd - boxStart + 1} etiquetas gerado.`);
}

// Função para Gerar Etiqueta Manual (Refatorada)
async function handleGenerateManual() {
    const docInput = document.getElementById('manual-doc').value.trim();
    const nfInput = document.getElementById('manual-nf').value.trim();
    const solicitanteInput = document.getElementById('manual-solicitante').value.trim();
    const destInput = document.getElementById('manual-dest').value.trim();
    const cidadeInput = document.getElementById('manual-cidade').value.trim();
    const transpInput = document.getElementById('manual-transp').value.trim();
    const qtdTotal = parseInt(document.getElementById('manual-qtd').value) || 1;

    // Elementos de UI
    const zplArea = document.getElementById('generated-zpl-manual');
    const manualPreview = document.getElementById('manual-label-preview');
    const btnGenerate = document.getElementById('btn-manual-generate');
    const btnPrint = document.getElementById('btn-manual-print');

    if (!docInput || !nfInput || !destInput) {
        showToast("Preencha os campos obrigatórios (*)", "warning");
        return;
    }

    // 1. Gera o lote completo de ZPL (para o PDF de todas as etiquetas)
    // Usa o template importado de zpl-templates.js
    let fullZplBatch = "";
    for (let i = 1; i <= qtdTotal; i++) {
        fullZplBatch += getManualTemplate({
            documento: docInput,
            nf: nfInput,
            solicitante: solicitanteInput,
            destinatario: destInput,
            cidade: cidadeInput,
            transportadora: transpInput,
            volAtual: i,
            volTotal: qtdTotal
        });
    }
    zplArea.value = fullZplBatch;

    // 2. Gera apenas a primeira etiqueta para o Preview na tela
    const previewZpl = getManualTemplate({
        documento: docInput,
        nf: nfInput,
        solicitante: solicitanteInput,
        destinatario: destInput,
        cidade: cidadeInput,
        transportadora: transpInput,
        volAtual: 1,
        volTotal: qtdTotal
    });

    // 3. Chama o Serviço de API (labelary.js)
    // Nota: Passamos '4x6' como tamanho padrão para a etiqueta manual
    await fetchPreview('4x6', previewZpl, btnGenerate, btnPrint, manualPreview, 'Gerar Etiqueta', false);
}
async function fetchPreview(sizeKey, zpl, btn, btnPrint, previewContainer, btnText, rotate = false) {
    btn.disabled = true; btn.innerText = 'Gerando...'; 
    previewContainer.innerHTML = ''; 
    const spinner = document.createElement('span'); spinner.className = 'spinner'; previewContainer.appendChild(spinner);
    
    try {
        const blob = await fetchLabelPreview(zpl, sizeKey);
        const imageUrl = URL.createObjectURL(blob);
        
        previewContainer.innerHTML = '';
        const img = document.createElement('img'); img.src = imageUrl; img.className = "bg-white rounded-lg shadow-sm";
        img.style.cssText = rotate ? 'transform: rotate(90deg) scale(0.55); transform-origin: center; width: auto; height: auto;' : 'width: 100%; height: 100%; object-fit: contain;';
        previewContainer.appendChild(img);
        
        btnPrint.disabled = false;
    } catch (e) { 
        console.error(e);
        previewContainer.innerHTML = ''; 
        const errSpan = document.createElement('span'); errSpan.className = 'text-red-400 text-xs'; errSpan.textContent = 'Erro na API'; 
        previewContainer.appendChild(errSpan);
    } finally { 
        btn.disabled = false; btn.innerText = btnText; 
    }
}

async function handlePrintPDF(zplId, sizeId, btnId, fixedSize) {
    const zplContent = document.getElementById(zplId).value;
    const sizeKey = fixedSize || document.getElementById(sizeId).value;
    const btn = document.getElementById(btnId);
    if (!zplContent) return;
    
    btn.disabled = true; btn.innerText = "Baixando...";
    
    try {
        const blob = await fetchLabelPdf(zplContent, sizeKey);
        window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) { 
        console.error(e);
        showToast("Erro ao gerar PDF", 'error'); 
    } finally { 
        btn.disabled = false; btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>Baixar PDF`; 
    }
}