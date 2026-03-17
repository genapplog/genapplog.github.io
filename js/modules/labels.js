/**
 * ARQUIVO: js/modules/labels.js
 * DESCRIÇÃO: Gerador de ZPL e Integração com API Labelary.
 */
import { safeBind, showToast } from '../utils.js';
import { LABEL_DIMENSIONS, CD_DATA } from './labels-data.js';
import { getAmazonTemplate, getManualTemplate } from './zpl-templates.js';
import { fetchLabelPreview, fetchLabelPdf } from '../services/labelary.js';
import { PDFDocument } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js';

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
        ['zpl-menu', 'zpl-tool-amazon', 'zpl-tool-manual', 'zpl-tool-validation'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.classList.add('hidden');
        });
        document.getElementById(targetId).classList.remove('hidden');
    };

    safeBind('btn-open-amazon', 'click', () => toggleTool('zpl-tool-amazon'));
    safeBind('btn-back-zpl', 'click', () => toggleTool('zpl-menu'));
    safeBind('btn-open-manual', 'click', () => toggleTool('zpl-tool-manual'));
    safeBind('btn-back-zpl-manual', 'click', () => toggleTool('zpl-menu'));
    safeBind('btn-open-validation', 'click', () => toggleTool('zpl-tool-validation'));
    safeBind('btn-back-zpl-validation', 'click', () => toggleTool('zpl-menu'));

    setupValidationTool();

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
let currentPreviewUrl = null; // ✅ Variável para rastrear a imagem e evitar vazamento de memória

async function fetchPreview(sizeKey, zpl, btn, btnPrint, previewContainer, btnText, mode = 'normal') {
    if(btn) { btn.disabled = true; btn.innerText = 'Gerando...'; }
    if(previewContainer) previewContainer.innerHTML = '<div class="flex items-center justify-center h-full w-full"><span class="animate-spin h-8 w-8 border-4 border-indigo-500 rounded-full border-t-transparent"></span></div>';
    
    try {
        // ✅ Limpa a memória da imagem anterior antes de gerar uma nova
        if (currentPreviewUrl) {
            URL.revokeObjectURL(currentPreviewUrl);
            currentPreviewUrl = null;
        }

        const blob = await fetchLabelPreview(zpl, sizeKey);
        currentPreviewUrl = URL.createObjectURL(blob);
        const imageUrl = currentPreviewUrl;
        
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
    
    if(btn) { btn.disabled = true; btn.innerText = "Processando..."; }
    
    try {
        // 1. Separa o ZPL em etiquetas individuais (dividindo pela tag final ^XZ)
        const rawLabels = zplContent.split('^XZ');
        const validLabels = rawLabels.filter(l => l.trim().length > 0).map(l => l + '^XZ');

        // 2. Cria os lotes de no máximo 50 etiquetas para a API não travar
        const batches = [];
        for (let i = 0; i < validLabels.length; i += 50) {
            batches.push(validLabels.slice(i, i + 50).join('\n'));
        }

        // 3. Se for só um lote (até 50), processa normal e super rápido
        if (batches.length === 1) {
            const blob = await fetchLabelPdf(batches[0], sizeKey);
            const pdfUrl = URL.createObjectURL(blob);
            window.open(pdfUrl, '_blank');
            setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000); // ✅ Libera a memória RAM após 1 minuto
        }
        // 4. Se tiver mais de um lote, chama a API várias vezes e costura o PDF
        else {
            const mergedPdf = await PDFDocument.create();

            for (let i = 0; i < batches.length; i++) {
                if(btn) { btn.innerText = `Lote ${i + 1} de ${batches.length}...`; }
                
                // Pausa de 1.5 segundos entre os lotes para evitar o bloqueio (Erro 429 - Too Many Requests)
                if (i > 0) await new Promise(resolve => setTimeout(resolve, 1500));
                
                let blob = null;
                let tentativas = 0;
                let sucesso = false;

                // Tenta baixar o lote até 3 vezes caso a internet pisque
                while (!sucesso && tentativas < 3) {
                    try {
                        blob = await fetchLabelPdf(batches[i], sizeKey);
                        sucesso = true;
                    } catch (err) {
                        tentativas++;
                        if (tentativas >= 3) throw err; // Se falhar 3 vezes, desiste de vez
                        console.warn(`Falha na rede (Lote ${i+1}). Tentativa ${tentativas}/3. Reconectando...`);
                        if(btn) { btn.innerText = `Reconectando lote ${i + 1}...`; }
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Espera 2 segundos antes de tentar de novo
                    }
                }
                
                const arrayBuffer = await blob.arrayBuffer();
                const pdfToMerge = await PDFDocument.load(arrayBuffer);
                
                const copiedPages = await mergedPdf.copyPages(pdfToMerge, pdfToMerge.getPageIndices());
                copiedPages.forEach((page) => mergedPdf.addPage(page));
            }

            if(btn) { btn.innerText = "Finalizando..."; }
            const mergedPdfBytes = await mergedPdf.save();
            const finalBlob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
            const pdfUrl = URL.createObjectURL(finalBlob);
            window.open(pdfUrl, '_blank');
            setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000); // ✅ Libera a memória RAM pesada do PDF costurado após 1 minuto
        }
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

// =========================================================
// LÓGICA DE VALIDAÇÃO (GS1 ANALYZE)
// =========================================================
function setupValidationTool() {
    const input = document.getElementById('input-barcode-scanner');
    const btnCam = document.getElementById('btn-start-camera');
    const btnStop = document.getElementById('btn-stop-camera');
    const camContainer = document.getElementById('camera-container');
    let html5QrCode = null;

    if (!input) return;

    // --- LEITURA VIA BIPER FÍSICO ---
    input.addEventListener('focus', () => { input.setAttribute('readonly', 'readonly'); setTimeout(() => { input.removeAttribute('readonly'); }, 100); });
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            analyzeScannedBarcode(input.value.trim());
            input.value = ''; 
        }
    });

    // --- LEITURA VIA CÂMARA DO TELEMÓVEL ---
    if (btnCam) {
        btnCam.addEventListener('click', () => {
            if (!window.Html5Qrcode) {
                btnCam.innerHTML = '<span class="animate-spin h-5 w-5 border-2 border-emerald-500 rounded-full border-t-transparent"></span><span class="font-bold">A carregar módulo...</span>';
                const script = document.createElement('script');
                script.src = "https://unpkg.com/html5-qrcode";
                script.onload = () => startCamera();
                document.head.appendChild(script);
            } else {
                startCamera();
            }
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', () => stopCamera());
    }

    let isCameraStarting = false;

    function startCamera() {
        // Proteção 1: Impede múltiplos cliques enquanto a câmara já está a iniciar ou a ler
        if ((html5QrCode && html5QrCode.isScanning) || isCameraStarting) return;
        isCameraStarting = true;

        btnCam.innerHTML = '<span class="font-bold text-emerald-400">Câmara a iniciar...</span>';
        camContainer.classList.remove('hidden');
        btnStop.classList.remove('hidden');

        if (!html5QrCode) {
            html5QrCode = new window.Html5Qrcode("qr-reader");
        }

        html5QrCode.start(
            { facingMode: "environment" }, // A configuração mais segura e à prova de falhas
            {
                fps: 10, // Uma taxa menor dá mais tempo para o celular focar sozinho
                // Um retângulo estreito obriga o foco de processamento em uma área bem pequena, agilizando a leitura
                qrbox: { width: 250, height: 100 }
            },
            (decodedText) => {
                // Sucesso!
                stopCamera();
                analyzeScannedBarcode(decodedText);
                showToast("Código lido com sucesso!", "success");
            },
            (errorMessage) => {
                // Ignora erros de frame vazio
            }
        ).then(() => {
            isCameraStarting = false; 
        }).catch(err => {
            isCameraStarting = false; 
            console.error("Erro detalhado da câmara:", err);
            const msgErro = err.name || err.message || "Erro desconhecido";
            showToast(`Falha na Câmera: ${msgErro}`, "error");
            stopCamera();
        });
    }

    function stopCamera() {
        camContainer.classList.add('hidden');
        btnStop.classList.add('hidden');
        btnCam.innerHTML = '<svg class="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg><span class="font-bold">Ler com Câmara do Telemóvel</span>';
        
        // Proteção 2: Para a câmera com segurança e limpa o HTML residual
        if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().then(() => {
                html5QrCode.clear(); // Previne o erro "Cannot clear while scan is ongoing" na próxima vez
            }).catch(err => console.error(err));
        }
    }
}

function analyzeScannedBarcode(code) {
    if (!code) return;

    const box = document.getElementById('validation-result-box');
    const typeEl = document.getElementById('val-type');
    const rawEl = document.getElementById('val-raw');
    const detailsContainer = document.getElementById('val-details-container');
    const detailsList = document.getElementById('val-details-list');

    // Reseta visualização
    box.classList.remove('hidden');
    rawEl.textContent = code;
    detailsList.innerHTML = '';
    detailsContainer.classList.add('hidden');

    const isNumeric = /^\d+$/.test(code);
    let type = 'Código Alfanumérico Livre / Code 128';
    let details = [];

    // Tabela de Identificação Padrão
    if (isNumeric && code.length === 12) {
        type = 'UPC-A (GTIN-12)';
    } else if (isNumeric && code.length === 13) {
        type = 'EAN-13 (GTIN-13)';
    } else if (isNumeric && code.length === 14) {
        type = 'DUN-14 / ITF-14 (GTIN-14)';
        details.push(`<li class="flex items-start gap-2"><span class="bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded text-xs font-bold border border-indigo-700/50">DUN</span> <span class="text-white font-mono">${code}</span></li>`);
        detailsContainer.classList.remove('hidden');
    } 
    // Identificação Avançada do GS1-128
    else if (code.length > 14 && (code.startsWith('01') || code.startsWith(']C1') || code.includes('(01)'))) {
        type = 'GS1-128';
        detailsContainer.classList.remove('hidden');
        
        // Limpa formatações e prefixos padrão de leitores
        let cleanCode = code.replace(/\(|\)/g, ''); 
        if (cleanCode.startsWith(']C1')) cleanCode = cleanCode.substring(3);

        let currentIndex = 0;

        // Loop inteligente que varre a string inteira separando os "vagões"
        while (currentIndex < cleanCode.length) {
            // Pula caracteres invisíveis (FNC1 / Group Separator - ASCII 29) que separam lotes
            if (cleanCode.charCodeAt(currentIndex) === 29) {
                currentIndex++;
                continue;
            }

            const remaining = cleanCode.substring(currentIndex);
            let advanced = false;

            // (01) GTIN ou (02) GTIN Contido - Fixo 14 dígitos
            if (remaining.startsWith('01') || remaining.startsWith('02')) {
                const ai = remaining.substring(0, 2);
                const val = remaining.substring(2, 16);
                const label = ai === '01' ? 'GTIN' : 'GTIN CONTIDO';
                details.push(`<li class="flex items-start gap-2"><span class="bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded text-[10px] font-bold border border-emerald-700/50 w-24 text-center">(${ai}) ${label}</span> <span class="text-white font-mono mt-0.5">${val}</span></li>`);
                currentIndex += 16;
                advanced = true;
            }
            // (00) SSCC Palete - Fixo 18 dígitos
            else if (remaining.startsWith('00')) {
                const val = remaining.substring(2, 20);
                details.push(`<li class="flex items-start gap-2"><span class="bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded text-[10px] font-bold border border-purple-700/50 w-24 text-center">(00) SSCC</span> <span class="text-white font-mono mt-0.5">${val}</span></li>`);
                currentIndex += 20;
                advanced = true;
            }
            // Datas (11 Fab, 13 Emb, 15 Melhor, 17 Validade) - Fixo 6 dígitos
            else if (/^(11|13|15|17)/.test(remaining)) {
                const ai = remaining.substring(0, 2);
                const val = remaining.substring(2, 8);
                const labels = {'11': 'FABRICAÇÃO', '13': 'EMBALAGEM', '15': 'MELHOR ANTES', '17': 'VALIDADE'};
                details.push(`<li class="flex items-start gap-2"><span class="bg-cyan-900/50 text-cyan-300 px-2 py-0.5 rounded text-[10px] font-bold border border-cyan-700/50 w-24 text-center">(${ai}) ${labels[ai]}</span> <span class="text-white font-mono mt-0.5">${val} (AAMMDD)</span></li>`);
                currentIndex += 8;
                advanced = true;
            }
            // (310X) Peso Líquido em KG - Fixo 6 dígitos
            else if (/^310[0-9]/.test(remaining)) {
                const ai = remaining.substring(0, 4);
                const val = remaining.substring(4, 10);
                details.push(`<li class="flex items-start gap-2"><span class="bg-pink-900/50 text-pink-300 px-2 py-0.5 rounded text-[10px] font-bold border border-pink-700/50 w-24 text-center">(${ai}) PESO</span> <span class="text-white font-mono mt-0.5">${val} kg</span></li>`);
                currentIndex += 10;
                advanced = true;
            }
            // Variáveis: (10) Lote, (21) Série, (37) Quantidade
            else if (/^(10|21|37)/.test(remaining)) {
                const ai = remaining.substring(0, 2);
                const labels = {'10': 'LOTE', '21': 'SÉRIE', '37': 'QTD'};
                
                let val = "";
                let i = 2;
                // Lê o valor até o final da string OU até encontrar um separador de lote invisível (ASCII 29)
                while (i < remaining.length && remaining.charCodeAt(i) !== 29) {
                    val += remaining[i];
                    i++;
                }
                details.push(`<li class="flex items-start gap-2"><span class="bg-amber-900/50 text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold border border-amber-700/50 w-24 text-center">(${ai}) ${labels[ai]}</span> <span class="text-white font-mono mt-0.5 break-all">${val}</span></li>`);
                currentIndex += i; 
                advanced = true;
            }

            // Se achou um código maluco da indústria que não conhecemos, joga em "Outros" e encerra
            if (!advanced) {
                details.push(`<li class="flex items-start gap-2 mt-2"><span class="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] font-bold border border-slate-600 w-24 text-center">OUTROS (AIs)</span> <span class="text-white font-mono mt-0.5 break-all">${remaining}</span></li>`);
                break; 
            }
        }
    }

    typeEl.textContent = type;
    if (details.length > 0) {
        detailsList.innerHTML = details.join('');
    }
}