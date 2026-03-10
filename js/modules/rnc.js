/**
 * ARQUIVO: js/modules/rnc.js
 * DESCRIÇÃO: Gestão de Divergências (Versão Refatorada com ItemManager e Reports).
 */

import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    onSnapshot, collection, addDoc, updateDoc, deleteDoc, doc, getDocs, getDoc, 
    query, where, orderBy, writeBatch 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { safeBind, showToast, openConfirmModal, closeConfirmModal, sendDesktopNotification, requestNotificationPermission, escapeHtml, renderEmptyState } from '../utils.js';
import { PATHS } from '../config.js';
import { getUserRole, getCurrentUserName, isProfileLoaded } from './auth.js';
import { initDashboard, updateTVRealtime } from './dashboard.js';
import { registerLog } from './admin.js';
import { getClientNames } from './clients.js'; // ✅ Importando nomes dos clientes
import { printRncById } from './reports.js';
import { createItemRow, extractItemsFromTable, validateItems, clearTable } from './item-manager.js';
import { getProductData } from './product-cache.js'; // ✅ Importa a Busca Local

// --- ESTADO ---
let currentCollectionRef = null;
let globalDb = null;
let bindingsInitialized = false;
let allOccurrencesData = [];
let pendingOccurrencesData = [];
// ❌ REMOVIDO: let tempItemsList = []; (Agora o estado é o DOM)
let isScanning = false; 
let isSaving = false;   
let currentOccurrenceId = null;
let currentFormStatus = 'draft';
let unsubscribeOccurrences = null;

// =========================================================
// INICIALIZAÇÃO
// =========================================================

// =========================================================
// INICIALIZAÇÃO
// =========================================================
export async function initRncModule(db, isTest) {
    console.log("Iniciando Módulo RNC (Refatorado)...");
    globalDb = db; 
    currentCollectionRef = collection(db, PATHS.occurrences);

    // 1. Configurações que não dependem de dados (Botões, Dashboard, Notificações)
    if (!bindingsInitialized) { 
        setupRncBindings(); 
        initDashboard(db); 
        requestNotificationPermission(); 
        bindingsInitialized = true; 
    }

    // 2. Função interna que decide se carrega a lista ou bloqueia
    const startListListener = () => {
        const roles = getUserRole() || [];
        // ✅ ATUALIZADO: Operador também pode VER a lista (mas não editar)
        const canViewList = roles.some(r => ['ADMIN', 'LIDER', 'INVENTARIO', 'OPERADOR'].includes(r));

        if (canViewList) {
            console.log("📋 Permissão confirmada. Carregando lista de RNC...");
            setupRealtimeListener(); // <--- CHAMA A FUNÇÃO NOVA ABAIXO
        } else {
            console.log("🔒 Perfil Operacional: Lista bloqueada.");
            const tbody = document.getElementById('pending-list-tbody');
            if(tbody) {
                tbody.innerHTML = `<tr><td colspan="100%" class="text-center p-8 text-slate-400">
                    <div class="flex flex-col items-center gap-2">
                        <svg class="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                        <span>A visualização da lista é restrita à Liderança.</span>
                    </div>
                </td></tr>`;
            }
            // Mesmo bloqueado, carrega nomes de usuários para o formulário funcionar
            loadUserSuggestions(db);
        }
    };

    // 3. Lógica de Espera (Aguarda o Auth terminar de carregar o perfil)
    if (isProfileLoaded && isProfileLoaded()) {
        startListListener();
    } else {
        document.addEventListener('user-profile-ready', startListListener, { once: true });
    }
}

// =========================================================
// ✅ OTIMIZAÇÃO MAXIMA: SEPARAÇÃO TOTAL (PENDENTES vs HOJE)
// =========================================================
let unsubscribePendentes = null;
let unsubscribeHoje = null;

function setupRealtimeListener() {
    if (unsubscribeOccurrences) { unsubscribeOccurrences(); unsubscribeOccurrences = null; }
    if (unsubscribePendentes) unsubscribePendentes();
    if (unsubscribeHoje) unsubscribeHoje();

    // -------------------------------------------------------------
    // QUERY 1: APENAS PENDENTES (Alimenta a tela inicial e a tabela de RNC)
    // Custo de Leitura: Quase 0 (Apenas o que falta resolver)
    // -------------------------------------------------------------
    const qPendentes = query(currentCollectionRef, where('status', 'in', ['draft', 'pendente_lider', 'pendente_inventario', 'pendente']));
    
    unsubscribePendentes = onSnapshot(qPendentes, (snapshot) => {
        // 🔥 TRAVA ANTI-LOOP
        if (snapshot.metadata.hasPendingWrites) return;

        pendingOccurrencesData = [];
        
        snapshot.forEach(docSnap => {
            const d = docSnap.data(); 
            d.id = docSnap.id; 
            d.jsDate = d.createdAt?.toDate ? d.createdAt.toDate() : new Date();
            pendingOccurrencesData.push(d);
        });

        pendingOccurrencesData.sort((a, b) => b.jsDate - a.jsDate);
        
        updatePendingList(); // Desenha a tabela da tela principal
        
        // 🛑 RETIRADO DAQUI: O loadUserSuggestions(globalDb) faz uma chamada gigante.
        // Ele deve ser chamado APENAS QUANDO o utilizador abrir o modal de nova RNC,
        // não em tempo real a cada piscada do firebase!
    });

    // -------------------------------------------------------------
    // QUERY 2: APENAS HOJE (Alimenta APENAS a TV Wallboard em tempo real)
    // Custo de Leitura: Baixíssimo (Zera toda meia-noite)
    // -------------------------------------------------------------
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const qHoje = query(currentCollectionRef, where('createdAt', '>=', startOfToday));
    
    unsubscribeHoje = onSnapshot(qHoje, (snapshot) => {
        const dadosHoje = [];
        
        snapshot.forEach(docSnap => {
            const d = docSnap.data(); 
            d.id = docSnap.id; 
            d.jsDate = d.createdAt?.toDate ? d.createdAt.toDate() : new Date();
            dadosHoje.push(d);
        });

        // Envia os dados de hoje estritamente para a TV (Ignora o Dashboard de 7 dias)
        updateTVRealtime(dadosHoje);

        // Dispara as notificações de chamados novos
        snapshot.docChanges().forEach(change => {
            if (change.type === "added" || change.type === "modified") {
                const data = change.doc.data();
                const isRecent = data.createdAt?.toDate ? (new Date() - data.createdAt.toDate()) < 3600000 : true;
                if(isRecent && data.status !== 'concluido') checkAndNotify(data);
            }
        });
    });

    // Listener de notificações (Exclusivo da liderança - Mantido igual)
    const notificationsRef = collection(globalDb, `artifacts/${globalDb.app.options.appId}/public/data/notifications`);
    const recentTime = new Date(Date.now() - 5 * 60 * 1000); 
    onSnapshot(query(notificationsRef, where('createdAt', '>', recentTime)), {
        next: (snapshot) => { 
            snapshot.docChanges().forEach(change => { 
                if (change.type === "added") { 
                    const n = change.doc.data(); 
                    if (n.requesterEmail !== getAuth().currentUser?.email) { 
                        sendDesktopNotification("📢 Chamado", `Operador ${n.requesterName} no ${n.local || 'Local'}.`); 
                        showToast(`📢 ${n.requesterName} chamando!`, "warning"); 
                    } 
                } 
            }); 
        }, 
        error: () => {}
    });
}

// Função auxiliar para os botões estáticos (Extrai do código antigo para organizar)
function setupStaticListeners() {
    safeBind('btn-new-rnc', 'click', () => {
        document.getElementById('rnc-modal').classList.remove('hidden');
        document.getElementById('rnc-form').reset();
        document.getElementById('rnc-id').value = '';
        
        // Define data/hora atual
        const now = new Date();
        const localIsoString = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        document.getElementById('rnc-date').value = localIsoString;
        
        // Reset visual das abas
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active', 'border-blue-600', 'text-blue-600'));
        document.querySelector('[data-tab="tab-details"]').classList.add('active', 'border-blue-600', 'text-blue-600');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        document.getElementById('tab-details').classList.remove('hidden');

        // Esconde seções de Gestão se for novo
        document.getElementById('section-validation').classList.add('hidden');
        document.getElementById('section-conclusion').classList.add('hidden');
        
        // Mostra botão Salvar Rascunho
        const btnSave = document.getElementById('btn-save-rnc');
        if(btnSave) {
            btnSave.classList.remove('hidden');
            btnSave.innerText = "Salvar Rascunho";
        }
        
        // ✅ CHAMA AQUI UMA ÚNICA VEZ
        loadUserSuggestions(globalDb);
    });

    safeBind('btn-close-rnc', 'click', () => {
        document.getElementById('rnc-modal').classList.add('hidden');
    });
}

// ... (Mantenha o resto das funções: setupRealtimeListener, loadUserSuggestions, etc.) ...

function checkAndNotify(data) {
    // Implementação simples de notificação para não quebrar
    if(data.status === 'pendente_lider') showToast("Nova RNC aguardando Líder", "info");
}

function checkReminders() {
    // Lógica de reminders
}

function setupRncBindings() {
    // ✅ MELHORIA: Vincula a lista de usuários (datalist) também ao campo Infrator/Origem
    const inputInfrator = document.getElementById('form-infrator');
    if (inputInfrator) inputInfrator.setAttribute('list', 'rnc-users-list');

    document.querySelectorAll('.data-input, #smart-scanner-input, #req-smart-scanner').forEach(input => {
        if(input.type === 'text' || input.tagName === 'TEXTAREA') {
            input.addEventListener('input', function() { this.value = this.value.toUpperCase(); });
        }
    });

    safeBind('btn-open-pallet-req', 'click', () => { document.getElementById('ocorrencias-menu-view').classList.add('hidden'); document.getElementById('pallet-req-form').classList.remove('hidden'); resetReqForm(); });
    safeBind('btn-open-oc-novo', 'click', () => { document.getElementById('ocorrencias-menu-view').classList.add('hidden'); document.getElementById('ocorrencias-novo').classList.remove('hidden'); resetForm(); });
    safeBind('btn-back-pallet', 'click', closeReqForm);
    safeBind('btn-cancel-req', 'click', closeReqForm);
    safeBind('btn-back-oc-form', 'click', closeMainForm);
    safeBind('btn-cancel-occurrence', 'click', closeMainForm);
    
    safeBind('btn-save-req', 'click', (e) => handleSaveReq(e)); 
    safeBind('btn-save-occurrence', 'click', () => handleSave());
    safeBind('btn-reject-occurrence', 'click', () => handleReject());
    safeBind('btn-delete-permanent', 'click', () => handleDelete());
    
    // ✅ NOVA LÓGICA: ADICIONAR ITEM NA LISTA (USANDO O MÓDULO)
    safeBind('btn-add-item-list', 'click', (e) => { 
        e.preventDefault(); 
        handleAddItemToTable(); // Função refatorada abaixo
    });

    safeBind('req-smart-scanner', 'change', async (e) => { const b = e.target.value.trim().toUpperCase(); if (b) { await handleReqSmartScan(b); e.target.value = ''; } });
    safeBind('smart-scanner-input', 'change', async (e) => { const b = e.target.value.trim().toUpperCase(); if (b) { await handleSmartScan(b); e.target.value = ''; } });
    safeBind('form-item-cod', 'blur', async (e) => { const code = e.target.value.trim().toUpperCase(); if (code && !isScanning) await handleSmartScan(code); });

    const tbodyRNC = document.getElementById('pending-list-tbody');
    if (tbodyRNC) tbodyRNC.addEventListener('click', (e) => { const btn = e.target.closest('.btn-open-occurrence'); if (btn) openOccurrenceForEdit(btn.dataset.id); }); 
    
    const tbodyPallet = document.getElementById('pallet-list-tbody');
    if (tbodyPallet) tbodyPallet.addEventListener('click', (e) => { 
        const btn = e.target.closest('button');
        if (btn) {
            e.stopPropagation(); 
            if (btn.classList.contains('btn-print-pallet')) handleFinishLabel(btn.dataset.id);
            if (btn.classList.contains('btn-delete-pallet')) handleDeleteLabel(btn.dataset.id);
        }
    }); 
    
    safeBind('btn-cancel-leader-auth', 'click', () => { document.getElementById('leader-auth-modal').classList.add('hidden'); document.getElementById('auth-leader-pin').value = ''; });
    safeBind('btn-confirm-leader-auth', 'click', () => submitLeaderAuth());
    
    // ✅ MELHORIA: Permite validar com ENTER no campo de PIN
    const pinInput = document.getElementById('auth-leader-pin');
    if(pinInput) {
        pinInput.addEventListener('keypress', (e) => {
            if(e.key === 'Enter') {
                e.preventDefault(); // Evita comportamentos padrão de form
                submitLeaderAuth();
            }
        });
    }

    safeBind('btn-call-leader-remote', 'click', callLeaderRemote);
}

// =================================================================
// LÓGICA DE SOLICITAÇÃO DE PALETE (Mantida igual)
// =================================================================
async function handleSaveReq(e) {
    if(e) e.preventDefault(); 
    const btn = document.getElementById('btn-save-req'); 
    const embarque = document.getElementById('req-embarque').value.toUpperCase();
    const box = document.getElementById('req-box').value.toUpperCase();
    const checkout = document.getElementById('req-checkout').value.toUpperCase();
    const item = document.getElementById('req-item').value.toUpperCase();
    const lote = document.getElementById('req-lote').value.toUpperCase();
    const qtd = document.getElementById('req-qtd').value;

    if (!item || !qtd) { showToast("Preencha Item e Quantidade.", "error"); return; }
    
    const data = { 
        embarque, box, checkout, item, lote, qtd, 
        status: 'pendente', createdAt: new Date(), type: 'pallet_label_request' 
    };

    try {
        btn.disabled = true; 
        btn.innerHTML = `<svg class="w-4 h-4 animate-spin inline-block" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Enviando...`; 
        const docRef = await addDoc(currentCollectionRef, data);
        
        // ✅ Notifica o Inventário sobre a nova etiqueta solicitada
        const notificationsRef = collection(globalDb, `artifacts/${globalDb.app.options.appId}/public/data/notifications`);
        await addDoc(notificationsRef, {
            type: 'pallet_req_alert',
            title: '🏷️ Nova Etiqueta Palete',
            message: `Item: ${item} - Qtd: ${qtd}`,
            requesterName: getCurrentUserName() || "Operador",
            createdAt: new Date(),
            roles: ['ADMIN', 'INVENTARIO'] 
        });

        showToast("Solicitação enviada e Inventário notificado!"); 
        closeReqForm(); 
    } catch (err) { console.error(err); showToast("Erro ao enviar.", "error"); } finally { btn.disabled = false; btn.innerText = "Enviar Solicitação"; }
}

async function handleDeleteLabel(id) {
    openConfirmModal("Excluir Solicitação?", "Isso removerá o pedido da lista.", async () => {
        try { await deleteDoc(doc(currentCollectionRef, id)); showToast("Solicitação excluída."); closeConfirmModal(); } 
        catch (err) { console.error(err); showToast("Erro ao excluir.", "error"); }
    });
}

// =================================================================
// 🔥 NOVA LÓGICA MULTI-ITEM (USANDO item-manager.js)
// =================================================================

// Função chamada pelo botão "Adicionar"
function handleAddItemToTable() {
    // 1. Coleta dados dos inputs de "Staging" (cabeçalho do form)
    const tipo = document.querySelector('input[name="oc_tipo"]:checked')?.value || 'FALTA';
    const local = document.querySelector('input[name="oc_local"]:checked')?.value || 'ARMAZENAGEM';
    const itemCod = document.getElementById('form-item-cod').value.toUpperCase();
    const itemDesc = document.getElementById('form-item-desc').value.toUpperCase();
    const itemLote = document.getElementById('form-item-lote').value.toUpperCase();
    const itemQtd = document.getElementById('form-item-qtd').value;
    const itemEnd = document.getElementById('form-item-end').value.toUpperCase();

    // Captura Condições da Embalagem
    const conditions = [];
    if(document.getElementById('check-amassada')?.checked) conditions.push('AMASSADA');
    if(document.getElementById('check-rasgada')?.checked) conditions.push('RASGADA');
    if(document.getElementById('check-vazamento')?.checked) conditions.push('VAZAMENTO');
    
    const outrosEmb = document.getElementById('form-outros-emb')?.value.trim().toUpperCase();
    if(outrosEmb) conditions.push(outrosEmb);
    
    const itemObs = conditions.join(', ');

    // 2. Validações básicas antes de inserir
    if (!itemCod) return showToast("Informe o Código do Item.", "error");
    if (!itemQtd) return showToast("Informe a Quantidade.", "error");

    // 3. Monta o objeto de dados
    // Combina Área e Endereço (ex: SEPARAÇÃO 030-010-013)
    let localFinal = local;
    if(itemEnd) {
        localFinal = `${local} ${itemEnd}`;
    }

    const data = {
        tipo,
        local: localFinal, // ✅ Agora salva a Área + Endereço
        cod: itemCod,
        desc: itemDesc,
        lote: itemLote,
        qtd: itemQtd,
        end: itemEnd,
        obs: itemObs 
    };

    // 4. Cria a linha usando o Módulo e adiciona ao DOM
    let tbody = document.getElementById('rnc-items-list');
    
    // Fallback caso o ID no HTML ainda seja o antigo 'temp-items-tbody'
    if(!tbody) tbody = document.getElementById('temp-items-tbody');
    if(!tbody) return console.error("Tbody da lista de itens não encontrado!");

    // Exibe o container da lista se estiver oculto
    const listContainer = document.getElementById('items-list-container');
    if(listContainer) listContainer.classList.remove('hidden');

    tbody.appendChild(createItemRow(Date.now(), data));

    // 5. Limpa os inputs de staging para o próximo item
    document.getElementById('form-item-cod').value = '';
    document.getElementById('form-item-desc').value = '';
    document.getElementById('form-item-lote').value = '';
    document.getElementById('form-item-qtd').value = '';
    document.getElementById('form-item-end').value = '';
    
    // Limpa também as condições de embalagem para não repetir no próximo
    document.querySelectorAll('#ocorrencias-novo input[type="checkbox"]').forEach(el => el.checked = false);
    if(document.getElementById('form-outros-emb')) document.getElementById('form-outros-emb').value = '';

    // Foca no scanner novamente
    const scanner = document.getElementById('smart-scanner-input');
    if(scanner) scanner.focus();
    
    showToast("Item adicionado à lista!");
}


// =================================================================
// SCANNER & BUSCA
// =================================================================
function parseGS1(barcode) {
    let dun = ""; let lote = ""; let raw = barcode.replace(/[()]/g, ''); 
    if (raw.startsWith('01')) { dun = raw.substring(2, 16); raw = raw.substring(16); } 
    else if (raw.length >= 14 && !isNaN(raw.substring(0,14))) { dun = barcode.substring(0, 14); }
    let loops = 0;
    while (loops < 5 && raw.length > 0) { 
        if (raw.startsWith('11') || raw.startsWith('13') || raw.startsWith('17')) { raw = raw.substring(8); } 
        else if (raw.startsWith('10')) { lote = raw.substring(2); break; } 
        else { break; } loops++;
    }
    if (!lote) { const match = barcode.replace(/[()]/g, '').match(/10([a-zA-Z0-9]+)$/); if (match) lote = match[1]; }
    return { dun, lote };
}

async function handleSmartScan(barcode) {
    if (isScanning) return; 
    let { dun, lote } = parseGS1(barcode);
    if (!dun) dun = barcode.trim(); 
    if (lote) { const el = document.getElementById('form-item-lote'); if(el){ el.value = lote; highlightField(el); } }
    if (dun && globalDb) {
        isScanning = true; showToast(`Buscando...`, "info");
        const elCod = document.getElementById('form-item-cod'); 
        const elDesc = document.getElementById('form-item-desc');
        try {
            // ✅ Usa o Cache Local (0 Leituras na Nuvem)
            const prod = await getProductData(globalDb, dun);
            if (prod) { 
                elCod.value = (prod.codigo || dun).toUpperCase(); 
                elDesc.value = (prod.descricao || "").toUpperCase(); 
                highlightField(elCod); highlightField(elDesc); showToast("Encontrado!"); 
            } else { 
                elCod.value = dun.toUpperCase(); 
                if(!elDesc.value) { elDesc.value = ""; elDesc.placeholder = "DIGITE A DESCRIÇÃO"; }
                showToast("Novo produto.", "warning"); 
            }
        } catch (e) { console.error(e); } finally { isScanning = false; }
    }
    const qtd = document.getElementById('form-item-qtd'); if(qtd) qtd.focus();
}

async function handleReqSmartScan(barcode) {
    if (isScanning) return; 
    let { dun, lote } = parseGS1(barcode);
    if (!dun) dun = barcode.trim();
    if (lote) { const el = document.getElementById('req-lote'); if(el){ el.value = lote; highlightField(el); } }
    if (dun && globalDb) {
        isScanning = true; showToast(`Verificando...`, "info");
        try {
            // ✅ Usa o Cache Local (0 Leituras na Nuvem)
            const prod = await getProductData(globalDb, dun);
            const elItem = document.getElementById('req-item');
            if (prod) { 
                elItem.value = `${prod.codigo} - ${prod.descricao}`.toUpperCase(); 
                highlightField(elItem); showToast("OK!"); 
            } else { 
                elItem.value = dun.toUpperCase(); showToast("Não cadastrado.", "error"); 
            }
        } catch (e) { console.error(e); } finally { isScanning = false; }
    }
    const qtd = document.getElementById('req-qtd'); if(qtd) qtd.focus();
}

function highlightField(el) { if(el) { el.classList.add('bg-indigo-900/50', 'text-indigo-200'); setTimeout(() => el.classList.remove('bg-indigo-900/50', 'text-indigo-200'), 1000); } }

// === SALVAMENTO (REFATORADO) ===
async function handleSave() {
    if (isSaving) return;
    
    // 1. Extrai itens da tabela usando o Módulo
    let currentItems = extractItemsFromTable('rnc-items-list'); // Tenta pegar pelo ID correto
    if(currentItems.length === 0) currentItems = extractItemsFromTable('temp-items-tbody'); // Fallback

    // 2. Verifica se tem um item "pendente" nos inputs que o usuário esqueceu de clicar em "Adicionar"
    const pendingCod = document.getElementById('form-item-cod').value;
    if (pendingCod) {
        // Captura condições da embalagem para o item pendente também
        const conditions = [];
        if(document.getElementById('check-amassada')?.checked) conditions.push('AMASSADA');
        if(document.getElementById('check-rasgada')?.checked) conditions.push('RASGADA');
        if(document.getElementById('check-vazamento')?.checked) conditions.push('VAZAMENTO');
        
        const outrosEmb = document.getElementById('form-outros-emb')?.value.trim().toUpperCase();
        if(outrosEmb) conditions.push(outrosEmb);
        
        const itemObs = conditions.join(', ');

        // Lógica de Localização (Área + Endereço) para o item pendente
        const area = document.querySelector('input[name="oc_local"]:checked')?.value || 'N/A';
        const address = document.getElementById('form-item-end').value.toUpperCase();
        let localFinal = area;
        if(address) localFinal = `${area} ${address}`;

        // Se tiver, adiciona à lista para salvar junto (Feature de conveniência)
        currentItems.push({
            tipo: document.querySelector('input[name="oc_tipo"]:checked')?.value || 'N/A',
            local: localFinal, // Área + Endereço (Visual)
            // ✅ CORREÇÃO CRUCIAL: Salva o endereço separado para o relatório conseguir limpar depois
            item_end: address, 
            item_cod: pendingCod.toUpperCase(),
            item_desc: document.getElementById('form-item-desc').value.toUpperCase(),
            item_lote: document.getElementById('form-item-lote').value.toUpperCase(),
            item_qtd: document.getElementById('form-item-qtd').value || '1',
            item_obs: itemObs 
        });
    }

    if (currentFormStatus === 'draft') {
        const assColab = document.getElementById('form-ass-colab').value;
        if (!assColab.trim()) return showToast("Assine como Colaborador.", "error");
        
        // Validação via Módulo
        const check = validateItems(currentItems);
        if (!check.valid) {
            showToast(check.msg, "warning");
            return;
        }

        const pinField = document.getElementById('auth-leader-pin');
        const modal = document.getElementById('leader-auth-modal');
        pinField.value = ''; modal.classList.remove('hidden'); setTimeout(() => pinField.focus(), 50); 
        return; 
    }
    // Se não for draft, processa direto (Líder ou Inventário assinando)
    processSaveData(currentItems);
}

async function processSaveData(itemsToSave) {
    const btn = document.getElementById('btn-save-occurrence');
    const originalText = btn.innerHTML;
    
    // Se não foi passado itens (ex: chamado pelo modal de líder), extrai de novo
    if(!itemsToSave) {
        itemsToSave = extractItemsFromTable('rnc-items-list');
        if(itemsToSave.length === 0) itemsToSave = extractItemsFromTable('temp-items-tbody');
    }

    try {
        isSaving = true; btn.disabled = true; 
        btn.innerHTML = `<svg class="w-4 h-4 animate-spin inline-block" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Salvando...`;

        const headerData = {
            updatedAt: new Date(), 
            embarque: document.getElementById('form-embarque').value.toUpperCase(), 
            nf: document.getElementById('form-nf').value.toUpperCase(), 
            dataRef: document.getElementById('form-data').value, 
            obs: document.getElementById('form-obs').value.toUpperCase(),
            infrator: document.getElementById('form-infrator').value.toUpperCase(),
            ass_colab: document.getElementById('form-ass-colab').value.toUpperCase(), 
            ass_lider: document.getElementById('form-ass-lider').value.toUpperCase(), 
            ass_inv: document.getElementById('form-ass-inv').value.toUpperCase()
        };

        let newStatus = currentFormStatus;
        if (currentFormStatus === 'draft') { newStatus = 'pendente_inventario'; headerData.createdAt = new Date(); }
        else if (currentFormStatus === 'pendente_lider') { newStatus = 'pendente_inventario'; }
        else if (currentFormStatus === 'pendente_inventario') { 
            if (!headerData.ass_inv.trim()) throw new Error("Assinatura Inventário obrigatória."); 
            newStatus = 'concluido'; 
        }
        headerData.status = newStatus;

        const docPayload = {
            ...headerData,
            items: itemsToSave, 
            // Campos legados para compatibilidade com listas simples
            tipo: itemsToSave[0]?.tipo || 'VÁRIOS',
            local: itemsToSave[0]?.local || 'VÁRIOS',
            item_cod: itemsToSave.length > 1 ? 'VÁRIOS ITENS' : itemsToSave[0]?.item_cod,
            item_desc: itemsToSave.length > 1 ? `LOTE DE ${itemsToSave.length} ITENS` : itemsToSave[0]?.item_desc
        };

        if (currentOccurrenceId) {
            await updateDoc(doc(currentCollectionRef, currentOccurrenceId), docPayload);
        } else {
            const docRef = await addDoc(currentCollectionRef, docPayload);
            
            // ✅ Notifica o Inventário sobre a nova RNC registrada
            const notificationsRef = collection(globalDb, `artifacts/${globalDb.app.options.appId}/public/data/notifications`);
            await addDoc(notificationsRef, {
                type: 'rnc_new_alert',
                title: '🚨 Nova RNC Registrada',
                message: `Embarque: ${headerData.embarque} - Item: ${itemsToSave[0]?.item_cod || 'Múltiplos'}`,
                requesterName: getCurrentUserName() || "Operador",
                occurrenceId: docRef.id,
                createdAt: new Date(),
                roles: ['ADMIN', 'INVENTARIO'] 
            });
        }

        showToast("Salvo e Inventário notificado!"); 
        closeMainForm();

    } catch(e) { console.error(e); showToast(e.message, "error"); } 
    finally { isSaving = false; btn.disabled = false; btn.innerHTML = originalText; }
}

// === INTERFACE DE LISTAGEM ===
function updatePendingList() {
    const tbodyRNC = document.getElementById('pending-list-tbody');
    const tbodyPallet = document.getElementById('pallet-list-tbody');
    const rncItems = pendingOccurrencesData.filter(item => item.type !== 'pallet_label_request');
    const palletItems = pendingOccurrencesData.filter(item => item.type === 'pallet_label_request');

    // ✅ Verifica se é estritamente Operador (Visualização somente leitura)
    const roles = getUserRole() || [];
    const isOnlyOperador = roles.includes('OPERADOR') && !roles.some(r => ['ADMIN', 'LIDER', 'INVENTARIO'].includes(r));

    if (tbodyRNC) {
        tbodyRNC.innerHTML = '';
        if (rncItems.length === 0) { 
            tbodyRNC.innerHTML = renderEmptyState(5, "Sem Pendências", "Nenhum RD pendente de validação.", "check"); 
        } else {
            rncItems.forEach(item => {
                const tr = document.createElement('tr');
                tr.className = "border-b border-slate-700 hover:bg-slate-750 transition-colors";
                
                let badge = '';
                let btnText = '';
                
                if (item.status === 'draft' && item.ass_lider) { 
                    badge = '<span class="px-2 py-1 rounded bg-amber-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-amber-900/50 animate-pulse">CORREÇÃO</span>';
                    btnText = 'Corrigir';
                } else if (item.status === 'draft') {
                    badge = '<span class="px-2 py-1 rounded bg-slate-700 text-slate-300 border border-slate-600 text-[10px] font-bold uppercase">RASCUNHO</span>';
                    btnText = 'Continuar';
                } else if (item.status === 'pendente_lider') {
                    badge = '<span class="badge-pending">Aguard. Líder</span>';
                    btnText = 'Assinar (Líder)';
                } else {
                    badge = '<span class="badge-blue">Aguard. Inv.</span>';
                    btnText = 'Validar (Inv.)';
                }

                let tipoDisplay = item.tipo;
                let descDisplay = item.item_desc || item.nf || '-';
                if (item.items && item.items.length > 1) {
                    tipoDisplay = `<span class="text-purple-400 font-bold">MÚLTIPLOS (${item.items.length})</span>`;
                    descDisplay = `<span class="text-xs text-slate-400">Vários Itens no Lote</span>`;
                }

                // ✅ CORREÇÃO: Operador pode editar SE for Rascunho/Correção ('draft')
                // Se for outro status (ex: pendente_lider), aí sim mostra "Aguardando".
                let canEdit = true;
                if (isOnlyOperador && item.status !== 'draft') {
                    canEdit = false;
                }

                const actionContent = !canEdit 
                    ? `<span class="text-[10px] text-slate-500 italic flex items-center justify-end gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Aguardando...</span>`
                    : `<button class="text-indigo-400 hover:text-white text-xs font-bold uppercase tracking-wide bg-indigo-900/30 px-3 py-1.5 rounded border border-indigo-500/30 hover:bg-indigo-600 transition-all btn-open-occurrence" data-id="${item.id}">${btnText}</button>`;
                tr.innerHTML = `
                    <td class="px-4 py-3 text-slate-300 font-mono text-xs">${item.jsDate.toLocaleDateString('pt-BR')}</td>
                    <td class="px-4 py-3 text-white font-medium">${item.embarque || '-'} <br> <span class="text-[10px] text-slate-500">${item.nf || ''}</span></td>
                    <td class="px-4 py-3 text-slate-300 text-xs">${tipoDisplay}<br>${descDisplay}</td>
                    <td class="px-4 py-3">${badge}</td>
                    <td class="px-4 py-3 text-right">
                        ${actionContent}
                    </td>`;
                tbodyRNC.appendChild(tr);
            });
        }
    }
    
    // TABELA DE PALETES (Mantida igual)
    if (tbodyPallet) {
        tbodyPallet.innerHTML = '';
        const myRole = getUserRole() || [];
        const canDelete = myRole.includes('INVENTARIO') || myRole.includes('ADMIN') || myRole.includes('LIDER');
        const canFinish = myRole.includes('INVENTARIO') || myRole.includes('ADMIN');

        if (palletItems.length === 0) {
            tbodyPallet.innerHTML = renderEmptyState(7, "Sem Pendências", "As solicitações de etiquetas aparecerão aqui.", "inbox"); 
        } else {
            palletItems.forEach(item => { 
                const tr = document.createElement('tr'); 
                tr.className = "border-b border-slate-700 hover:bg-slate-750 transition-colors"; 
                
                const deleteBtn = canDelete ? `<button class="text-red-500 hover:text-white hover:bg-red-900/30 p-2 rounded ml-2 btn-delete-pallet" data-id="${item.id}" title="Excluir"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : '';
                const finishBtn = canFinish ? `<button class="border border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded transition-all btn-print-pallet" data-id="${item.id}">OK</button>` : `<span class="text-[10px] text-slate-500 italic px-2">Aguardando</span>`;
                let localInfo = '-'; if(item.box) localInfo = `BOX: ${item.box}`; if(item.checkout) localInfo = `CHK: ${item.checkout}`; if(item.box && item.checkout) localInfo = `BOX: ${item.box} / CHK: ${item.checkout}`;

                tr.innerHTML = `
                    <td class="px-6 py-3 text-slate-300 font-mono text-xs">${item.jsDate.toLocaleDateString('pt-BR')}<br>${item.jsDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</td>
                    <td class="px-6 py-3 text-white text-xs font-bold text-indigo-300">${item.item || '-'}</td>
                    <td class="px-6 py-3 text-white text-xs text-slate-400">${item.lote || '-'}</td>
                    <td class="px-6 py-3 text-cyan-400 font-bold text-lg text-center">${item.qtd}</td>
                    <td class="px-6 py-3 text-white text-xs">${item.embarque || '-'}</td>
                    <td class="px-6 py-3 text-white text-xs">${localInfo}</td>
                    <td class="px-6 py-3 text-right flex items-center justify-end gap-2 h-full">${finishBtn}${deleteBtn}</td>`; 
                tbodyPallet.appendChild(tr); 
            }); 
        } 
    }
}

function updateFormStateUI() {
    const status = currentFormStatus; 
    const inputColab = document.getElementById('form-ass-colab'), inputLider = document.getElementById('form-ass-lider'), inputInv = document.getElementById('form-ass-inv');
    const btnSave = document.getElementById('btn-save-occurrence'), btnReject = document.getElementById('btn-reject-occurrence'), btnDelete = document.getElementById('btn-delete-permanent'); 
    const btnAdd = document.getElementById('btn-add-item-list');
    const listContainer = document.getElementById('items-list-container');

    if(!inputColab) return;
    
    inputColab.disabled = true; inputLider.disabled = true; inputInv.disabled = true; 
    btnReject.classList.add('hidden'); btnDelete.classList.add('hidden'); btnSave.classList.remove('hidden');
    
    const myRole = getUserRole() || [];
    const isInventory = myRole.includes('INVENTARIO') || myRole.includes('ADMIN');
    const isLeader = myRole.includes('LIDER') || myRole.includes('ADMIN');

    // ✅ CORREÇÃO: Botão Excluir aparece SEMPRE para Admin/Inventário ou Dono do Rascunho se a RNC existir
    if (currentOccurrenceId && (isInventory || (currentFormStatus === 'draft'))) {
        btnDelete.classList.remove('hidden');
    }
    
    // Controle do Botão Adicionar (Só pode editar itens no rascunho ou se for inventário corrigindo)
    const canEditItems = (currentFormStatus === 'draft' || isInventory);
    if(btnAdd) {
        if(canEditItems) btnAdd.classList.remove('hidden');
        else btnAdd.classList.add('hidden');
    }
    
    // Exibe lista se já tiver itens
    const itemsTable = document.getElementById('rnc-items-list') || document.getElementById('temp-items-tbody');
    if(listContainer && itemsTable && itemsTable.children.length > 0) listContainer.classList.remove('hidden');

    const myName = getCurrentUserName();

    if (status === 'draft') {
        document.getElementById('form-status-bar').innerText = "Etapa 1: Abertura e Validação";
        inputColab.disabled = false; if (!inputColab.value) inputColab.value = myName; 
        inputLider.disabled = false; inputLider.value = ""; inputLider.placeholder = "Líder: Assine aqui para validar"; 
        inputInv.value = ""; inputInv.placeholder = "Habilita na Etapa Final"; 
        btnSave.innerHTML = `Validar e Enviar p/ Inventário`;
        if(currentOccurrenceId) { btnDelete.classList.remove('hidden'); }
    } else if (status === 'pendente_inventario') {
        document.getElementById('form-status-bar').innerText = "Etapa 3: Validação do Inventário";
        if (isInventory) { 
            inputInv.disabled = false; inputInv.value = myName; btnSave.innerText = "Validar e Finalizar"; btnReject.classList.remove('hidden'); btnDelete.classList.remove('hidden'); btnDelete.innerText = "Excluir RD"; 
        } else { 
            inputInv.value = ""; inputInv.placeholder = "Aguardando Inventário..."; btnSave.classList.add('hidden'); showToast("Aguardando validação do Inventário.", "info"); 
        }
    }
}

// ... Compatibilidade ...
async function submitLeaderAuth() { const pin = document.getElementById('auth-leader-pin').value.trim(); if (!pin) return showToast("Digite PIN.", "error"); const btn = document.getElementById('btn-confirm-leader-auth'); btn.disabled = true; try { const q = query(collection(globalDb, 'users'), where('pin', '==', pin)); const s = await getDocs(q); if (s.empty) { showToast("PIN inválido.", "error"); btn.disabled = false; return; } const u = s.docs[0].data(); if (!String(u.role).toUpperCase().includes('LIDER') && String(u.role).toUpperCase() !== 'ADMIN') { showToast("Sem permissão.", "error"); btn.disabled = false; return; } document.getElementById('form-ass-lider').value = u.name; document.getElementById('leader-auth-modal').classList.add('hidden'); processSaveData(); } catch (e) { console.error(e); } finally { btn.disabled = false; } }
async function callLeaderRemote() { const btn = document.getElementById('btn-call-leader-remote'); btn.disabled = true; try { await addDoc(collection(globalDb, `artifacts/${globalDb.app.options.appId}/public/data/notifications`), { type: 'leader_call', requesterName: getCurrentUserName() || "Op", requesterEmail: getAuth().currentUser?.email, createdAt: new Date(), read: false }); showToast("Chamado enviado!"); setTimeout(() => btn.disabled = false, 10000); } catch (e) { console.error(e); btn.disabled = false; } }
async function handleReject() { openConfirmModal("Devolver?", "Volta para rascunho.", async () => { try { await updateDoc(doc(currentCollectionRef, currentOccurrenceId), { status: 'draft', ass_lider: '', ass_inv: '', updatedAt: new Date() }); showToast("Devolvido."); registerLog('REJEITAR_RNC', currentOccurrenceId, 'Devolvido'); closeConfirmModal(); closeMainForm(); } catch { showToast("Erro.", "error"); } }); }
async function handleDelete() { openConfirmModal("Excluir?", "Irreversível.", async () => { try { await deleteDoc(doc(currentCollectionRef, currentOccurrenceId)); showToast("Excluído."); registerLog('EXCLUIR_RNC', currentOccurrenceId, 'Excluído'); closeConfirmModal(); closeMainForm(); } catch { showToast("Erro.", "error"); } }); }

// =================================================================
// EDIÇÃO (REFATORADO PARA USAR createItemRow)
// =================================================================
function openOccurrenceForEdit(id) { 
    const item = [...pendingOccurrencesData, ...allOccurrencesData].find(d => d.id === id); 
    if (!item) return; 
    currentOccurrenceId = item.id; 
    currentFormStatus = item.status; 
    
    // Limpa inputs de staging
    document.getElementById('form-item-cod').value = ""; 
    document.getElementById('form-item-desc').value = ""; 
    document.getElementById('form-item-lote').value = ""; 
    document.getElementById('form-item-qtd').value = ""; 
    document.getElementById('form-item-end').value = "";

    // Reconstrói a tabela usando o Módulo ItemManager
    // Tenta pegar pelo ID novo ou fallback para o antigo
    let tbody = document.getElementById('rnc-items-list') || document.getElementById('temp-items-tbody');
    
    if(tbody) {
        // Limpa tabela usando o módulo
        clearTable(tbody.id);
        
        // Determina lista de itens (suporta formato novo array ou formato antigo legado)
        let itemsToRender = [];
        if (item.items && Array.isArray(item.items)) { 
            itemsToRender = item.items; 
        } else { 
            itemsToRender = [{ 
                tipo: item.tipo, 
                local: item.local, 
                cod: item.item_cod, // Mapeia antigo -> novo
                desc: item.item_desc, 
                lote: item.item_lote, 
                qtd: item.item_qtd, 
                end: item.item_end 
            }]; 
        }

        // Renderiza cada linha
        itemsToRender.forEach((it, idx) => {
            // Normaliza chaves se vier do banco com nomes antigos
            const normalizedData = {
                tipo: it.tipo,
                local: it.local,
                cod: it.item_cod || it.cod,
                desc: it.item_desc || it.desc,
                lote: it.item_lote || it.lote,
                qtd: it.item_qtd || it.qtd,
                end: it.item_end || it.end,
                obs: it.item_obs || it.obs // ✅ CORREÇÃO: Recupera o detalhe salvo
            };
            tbody.appendChild(createItemRow(idx, normalizedData));
        });
    }

    const mapIds = {'form-embarque':item.embarque,'form-nf':item.nf,'form-obs':item.obs,'form-outros-emb':item.emb_outros,'form-infrator':item.infrator,'form-ass-colab':item.ass_colab,'form-ass-lider':item.ass_lider,'form-ass-inv':item.ass_inv}; 
    for (const [k, v] of Object.entries(mapIds)) { const el = document.getElementById(k); if(el) el.value = v || ''; } 
    if(item.dataRef) document.getElementById('form-data').value = item.dataRef; 
    
    updateFormStateUI(); 
    document.getElementById('ocorrencias-menu-view').classList.add('hidden'); 
    document.getElementById('ocorrencias-novo').classList.remove('hidden'); 
}

async function handleFinishLabel(id) { openConfirmModal("Concluir?", "Marcar como entregue.", async () => { try { await updateDoc(doc(currentCollectionRef, id), { status: 'concluido', updatedAt: new Date() }); showToast("Concluído!"); closeConfirmModal(); } catch(err) { console.error(err); } }); }
function closeReqForm() { document.getElementById('pallet-req-form').classList.add('hidden'); document.getElementById('ocorrencias-menu-view').classList.remove('hidden'); }
function closeMainForm() { document.getElementById('ocorrencias-novo').classList.add('hidden'); document.getElementById('ocorrencias-menu-view').classList.remove('hidden'); }
function resetReqForm() { ['req-embarque','req-box','req-checkout','req-item','req-lote','req-qtd','req-smart-scanner'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; }); document.getElementById('req-smart-scanner').focus(); }

function resetForm() { 
    currentOccurrenceId = null; 
    currentFormStatus = 'draft'; 
    
    // Limpa a tabela
    const tbody = document.getElementById('rnc-items-list') || document.getElementById('temp-items-tbody');
    if(tbody) clearTable(tbody.id);
    
    // Reseta Inputs
    document.getElementById('form-data').valueAsDate = new Date(); 
    document.getElementById('form-nf').value = ''; // Limpa cliente
    document.getElementById('form-embarque').value = '';
    document.querySelectorAll('input[type="checkbox"]').forEach(el => el.checked = false); 
    document.querySelectorAll('input[name="oc_tipo"]').forEach(r => r.checked = false); 
    document.querySelectorAll('input[name="oc_local"]').forEach(r => r.checked = false); 
    
    // ✅ POPULA DATALIST DE CLIENTES
    const dataList = document.getElementById('rnc-client-list');
    if (dataList) {
        dataList.innerHTML = ''; // Limpa anteriores
        const clients = getClientNames(); // Pega atualizado do módulo clients.js
        clients.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            dataList.appendChild(option);
        });
    }

    updateFormStateUI(); 
}
// ✅ FUNÇÃO NOVA: Carrega lista de usuários para o campo de assinatura
async function loadUserSuggestions(db) {
    try {
        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);
        const dataList = document.getElementById('rnc-users-list');
        
        if (!dataList) return;

        dataList.innerHTML = ''; // Limpa lista atual

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.name) {
                const option = document.createElement('option');
                option.value = data.name.toUpperCase().trim(); // Padroniza em Maiúsculo
                dataList.appendChild(option);
            }
        });
        console.log("Lista de usuários carregada para sugestões.");
    } catch (error) {
        console.error("Erro ao carregar usuários:", error);
    }
}
// =================================================================
// 🔥 LÓGICA DE IMPRESSÃO GLOBAL
// =================================================================
window.printRncReport = printRncById;
window.printOccurrence = printRncById;