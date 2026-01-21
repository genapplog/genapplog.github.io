/**
 * ARQUIVO: js/modules/labels.js
 * DESCRIÇÃO: Gerador de ZPL e Integração com API Labelary.
 */
import { safeBind, showToast } from '../utils.js';
import { LABEL_DIMENSIONS, CD_DATA } from './labels-data.js';
import { getAmazonTemplate, getManualTemplate } from './zpl-templates.js';
import { fetchLabelPreview, fetchLabelPdf } from '../services/labelary.js';

// --- HELPER DE BUSCA DE INPUTS ---
function getSmartValue(ids, containerId = 'zpl-tool-manual', inputIndex = -1) {
    if (!Array.isArray(ids)) ids = [ids];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.value) return el.value.trim().toUpperCase();
    }
    if (inputIndex >= 0 && containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            const inputs = container.querySelectorAll('input[type="text"]');
            if (inputs[inputIndex]) return inputs[inputIndex].value.trim().toUpperCase();
        }
    }
    return "";
}

export function initLabelsModule() {
    console.log("Iniciando Módulo de Etiquetas...");

    // Navegação
    const toggleTool = (targetId) => {
        ['zpl-menu', 'zpl-tool-amazon', 'zpl-tool-manual'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.classList.add('hidden');
        });
        document.getElementById(targetId).classList.remove('hidden');
    };

    safeBind('btn-open-amazon', 'click', () => toggleTool('zpl-tool-amazon'));
    safeBind('btn-back-zpl', 'click', () => toggleTool('zpl-menu'));
    safeBind('btn-open-manual', 'click', () => toggleTool('zpl-tool-manual'));
    safeBind('btn-back-zpl-manual', 'click', () => toggleTool('zpl-menu'));

    // Toggle Código (Debug)
    safeBind('btn-toggle-zpl-amazon', 'click', () => document.getElementById('box-zpl-amazon').classList.toggle('hidden'));
    safeBind('btn-toggle-zpl-manual', 'click', () => document.getElementById('box-zpl-manual').classList.toggle('hidden'));

    setupInputBehaviors();

    // Ações - Amazon
    safeBind('generateButton', 'click', () => handleGenerateAmazon());
    safeBind('printButton', 'click', () => handlePrintPDF('zplCode', 'selectTamanho', 'printButton'));

    // Ações - Manual
    safeBind('generateButtonManual', 'click', () => handleGenerateManual());
    safeBind('printButtonManual', 'click', () => handlePrintPDF('generated-zpl-manual', null, 'printButtonManual', '4x3'));
}

function setupInputBehaviors() {
    // Limpeza NF Amazon
    const inputNf = document.getElementById('inputChaveNf');
    if (inputNf) {
        inputNf.removeAttribute('maxlength');
        inputNf.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').substring(0, 44);
        });
    }

    // UpperCase Global para Manual
    document.querySelectorAll('#zpl-tool-manual input').forEach(input => {
        input.addEventListener('input', function() { this.value = this.value.toUpperCase(); });
    });

    // Sincronia de Quantidades (Manual)
    const manualContainer = document.getElementById('zpl-tool-manual');
    if(manualContainer) {
        const numInputs = manualContainer.querySelectorAll('input[type="number"]');
        if(numInputs.length >= 3) {
            numInputs[0].addEventListener('input', (e) => numInputs[2].value = e.target.value);
        }
    }
    
    // Sincronia de Quantidades (Amazon)
    safeBind('inputQuantidadeTotal', 'input', (e) => { 
        const el = document.getElementById('inputCaixaFinal');
        if(el) el.value = e.target.value; 
    });
}

// =========================================================
// LÓGICA AMAZON
// =========================================================
async function handleGenerateAmazon() {
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

    if (!cdInfo || isNaN(boxStart) || isNaN(boxEnd)) { showToast("Verifique os dados.", 'error'); return; }

    let fullZplBatch = ""; 
    for (let i = boxStart; i <= boxEnd; i++) {
        fullZplBatch += getAmazonTemplate(dimensionConfig, cdCode, cdInfo, nfKey, poNumber, i, totalQty);
    }
    zplArea.value = fullZplBatch;

    const previewZpl = getAmazonTemplate(dimensionConfig, cdCode, cdInfo, nfKey, poNumber, boxStart, totalQty);
    
    // MODO 'AMAZON-ROTATED': Preenche e rotaciona
    fetchPreview(sizeKey, previewZpl, btn, btnPrint, preview, 'Gerar Etiqueta', 'amazon-rotated');
}

// =========================================================
// LÓGICA MANUAL
// =========================================================
async function handleGenerateManual() {
    const docInput = getSmartValue(['manual-doc', 'inputManualDocumento'], 'zpl-tool-manual', 0);
    const nfInput = getSmartValue(['manual-nf', 'inputManualNf'], 'zpl-tool-manual', 1);
    const solicitanteInput = getSmartValue(['manual-solicitante', 'inputManualSolicitante'], 'zpl-tool-manual', 2);
    const destInput = getSmartValue(['manual-dest', 'inputManualDest'], 'zpl-tool-manual', 3);
    const cidadeInput = getSmartValue(['manual-cidade', 'inputManualCidade'], 'zpl-tool-manual', 4);
    const transpInput = getSmartValue(['manual-transp', 'inputManualTransp'], 'zpl-tool-manual', 5);

    const container = document.getElementById('zpl-tool-manual');
    const numInputs = container ? container.querySelectorAll('input[type="number"]') : [];
    const qtdTotal = (numInputs[0] && numInputs[0].value) ? parseInt(numInputs[0].value) : 1;
    const inicioSeq = (numInputs[1] && numInputs[1].value) ? parseInt(numInputs[1].value) : 1;
    const fimSeq = (numInputs[2] && numInputs[2].value) ? parseInt(numInputs[2].value) : qtdTotal;

    // Tenta encontrar onde salvar o ZPL
    let zplArea = document.getElementById('generated-zpl-manual') || document.getElementById('zplCodeManual');
    if (!zplArea) zplArea = document.querySelector('#box-zpl-manual textarea');

    // Tenta encontrar onde exibir o preview
    let manualPreview = document.getElementById('manual-label-preview');
    if (!manualPreview) manualPreview = document.getElementById('previewManual');
    
    // Fallback visual para o preview
    if (!manualPreview) {
        const dashedBox = document.querySelector('#zpl-tool-manual .border-dashed');
        if (dashedBox) manualPreview = dashedBox;
    }

    const btnGenerate = document.getElementById('generateButtonManual');
    const btnPrint = document.getElementById('printButtonManual');

    if (!docInput || !nfInput || !destInput) { 
        showToast("Preencha: Doc, Nota e Destinatário", "warning"); 
        return; 
    }

    let fullZplBatch = "";
    for (let i = inicioSeq; i <= fimSeq; i++) {
        fullZplBatch += getManualTemplate({
            documento: docInput, nf: nfInput, solicitante: solicitanteInput,
            destinatario: destInput, cidade: cidadeInput, transportadora: transpInput,
            volAtual: i, volTotal: qtdTotal
        });
    }
    
    if (zplArea) zplArea.value = fullZplBatch;

    const previewZpl = getManualTemplate({
        documento: docInput, nf: nfInput, solicitante: solicitanteInput,
        destinatario: destInput, cidade: cidadeInput, transportadora: transpInput,
        volAtual: inicioSeq, volTotal: qtdTotal
    });

    await fetchPreview('4x3', previewZpl, btnGenerate, btnPrint, manualPreview, 'Gerar Etiqueta', 'horizontal');
}

// =========================================================
// SERVIÇOS DE API
// =========================================================
async function fetchPreview(sizeKey, zpl, btn, btnPrint, previewContainer, btnText, mode = 'normal') {
    if(btn) { btn.disabled = true; btn.innerText = 'Gerando...'; }
    if(previewContainer) previewContainer.innerHTML = '<div class="flex items-center justify-center h-full w-full"><span class="animate-spin h-8 w-8 border-4 border-indigo-500 rounded-full border-t-transparent"></span></div>';
    
    try {
        const blob = await fetchLabelPreview(zpl, sizeKey);
        const imageUrl = URL.createObjectURL(blob);
        
        if(previewContainer) {
            previewContainer.innerHTML = '';
            const img = document.createElement('img'); 
            img.src = imageUrl; 
            img.className = "bg-white shadow-md border border-slate-700 rounded mx-auto"; 
            
            // Zoom reduzido para 0.55 na Amazon para não cortar
            if (mode === 'amazon-rotated') {
                img.style.cssText = 'transform: rotate(90deg) scale(0.55); transform-origin: center; display: block; margin: 30px auto;';
            } else {
                img.style.cssText = 'width: 100%; height: auto; max-height: 100%; object-fit: contain; display: block; margin: 0 auto;';
            }
            previewContainer.appendChild(img);
        }
        if(btnPrint) btnPrint.disabled = false;
    } catch (e) { 
        console.error("Erro API Preview:", e);
        if(previewContainer) previewContainer.innerHTML = '<div class="flex items-center justify-center h-full text-red-400 text-xs p-4">Erro de Visualização</div>';
    } finally { 
        if(btn) { btn.disabled = false; btn.innerText = btnText; }
    }
}

async function handlePrintPDF(zplId, sizeId, btnId, fixedSize) {
    let zplContent = "";
    
    // 1. Tenta pegar pelo ID direto
    const zplEl = document.getElementById(zplId);
    if (zplEl && zplEl.value) {
        zplContent = zplEl.value;
    } 
    // 2. Fallback Específico para MANUAL (Procura na caixa da ferramenta manual mesmo oculta)
    else if (fixedSize === '4x3' || zplId === 'generated-zpl-manual') {
         // Tenta achar o textarea dentro do container manual, mesmo que o container esteja hidden
         const manualContainer = document.getElementById('box-zpl-manual');
         if (manualContainer) {
             const area = manualContainer.querySelector('textarea');
             if (area && area.value) zplContent = area.value;
         }
    }

    // 3. Fallback Geral (Varre todos os textareas, ignorando visibilidade)
    if (!zplContent) {
        const textareas = document.querySelectorAll('textarea');
        textareas.forEach(t => {
            // ✅ CORREÇÃO: Verifica apenas se tem cara de ZPL, sem checar se está visível
            if(t.value.includes('^XA') && t.value.includes('^XZ')) {
                zplContent = t.value;
            }
        });
    }
    
    const sizeKey = fixedSize || (document.getElementById(sizeId) ? document.getElementById(sizeId).value : '4x6');
    const btn = document.getElementById(btnId);
    
    if (!zplContent) { showToast("Gere a etiqueta primeiro.", "warning"); return; }
    
    if(btn) { btn.disabled = true; btn.innerText = "Baixando..."; }
    
    try {
        const blob = await fetchLabelPdf(zplContent, sizeKey);
        const pdfUrl = URL.createObjectURL(blob);
        window.open(pdfUrl, '_blank');
    } catch (e) { 
        console.error(e);
        showToast("Erro na API de PDF.", 'error'); 
    } finally { 
        if(btn) {
            btn.disabled = false; 
            btn.innerHTML = `<svg class="w-5 h-5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>PDF`; 
        }
    }
}