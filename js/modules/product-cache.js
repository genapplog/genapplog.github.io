/**
 * ARQUIVO: js/modules/product-cache.js
 * DESCRIÇÃO: Cache offline para produtos. Zera o consumo de leituras nas bipagens.
 */

import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const CACHE_KEY = 'appLog_productsData';
const SYNC_KEY = 'appLog_productsLastSync';

// Carrega o mapa da memória do navegador
function getLocalMap() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch(e) {
        return {};
    }
}

// Salva o mapa atualizado na memória
function saveLocalMap(map) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
}

// Sincroniza apenas as alterações recentes (Economia Extrema)
export async function syncProductsCache(db) {
    const lastSync = parseInt(localStorage.getItem(SYNC_KEY) || '0', 10);
    const lastSyncDate = new Date(lastSync);

    let q;
    if (lastSync === 0) {
        // Primeira vez abrindo o sistema: Baixa a lista completa (Gasta leituras apenas 1 vez na vida)
        q = collection(db, 'products');
    } else {
        // Próximas vezes: Baixa APENAS os produtos criados/editados desde o último acesso (Quase zero leituras)
        q = query(collection(db, 'products'), where('updatedAt', '>', lastSyncDate));
    }

    try {
        const snap = await getDocs(q);
        if (!snap.empty) {
            const map = getLocalMap();
            snap.forEach(docSnap => {
                const data = docSnap.data();
                map[docSnap.id] = {
                    id: docSnap.id,
                    codigo: data.codigo,
                    descricao: data.descricao
                };
            });
            saveLocalMap(map);
        }
        // Atualiza a data do último sync
        localStorage.setItem(SYNC_KEY, Date.now().toString());
        console.log(`📦 Cache de Produtos Pronto. Na memória: ${Object.keys(getLocalMap()).length} itens. Baixados agora: ${snap.size}`);
    } catch (e) {
        console.error("Erro ao sincronizar cache de produtos:", e);
    }
}

// Busca o produto (Tempo de resposta instantâneo, sem internet)
export async function getProductData(db, dunOrCodigo) {
    const map = getLocalMap();
    
    // 1. Tenta buscar direto pelo ID (Cód. Barras/DUN)
    if (map[dunOrCodigo]) return map[dunOrCodigo];
    
    // 2. Tenta buscar pelo Código SAP (Loop super rápido na memória)
    for (const key in map) {
        if (map[key].codigo === dunOrCodigo) return map[key];
    }

    // 3. Fallback de Segurança (Se não achou localmente, vai na nuvem perguntar)
    console.log(`⚠️ Produto ${dunOrCodigo} não encontrado no cache. Buscando no servidor...`);
    try {
        const docRef = doc(db, "products", dunOrCodigo);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const prod = docSnap.data();
            const result = { id: docSnap.id, codigo: prod.codigo, descricao: prod.descricao };
            map[docSnap.id] = result;
            saveLocalMap(map); // Salva no cache pra não buscar de novo na próxima bipagem
            return result;
        }

        const q = query(collection(db, 'products'), where('codigo', '==', dunOrCodigo));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const prod = snap.docs[0].data();
            const result = { id: snap.docs[0].id, codigo: prod.codigo, descricao: prod.descricao };
            map[result.id] = result;
            saveLocalMap(map);
            return result;
        }
    } catch (e) { console.error(e); }
    
    return null;
}

// Injeta um produto manualmente no cache (Usado na tela de Cadastros de Produtos)
export function updateLocalProductCache(id, codigo, descricao) {
    const map = getLocalMap();
    map[id] = { id, codigo, descricao };
    saveLocalMap(map);
}