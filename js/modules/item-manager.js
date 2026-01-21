/**
 * ARQUIVO: js/modules/item-manager.js
 * DESCRIÇÃO: Gerencia a adição, remoção e leitura da tabela dinâmica de itens na RNC.
 */

import { escapeHtml } from '../utils.js';

export function createItemRow(index, data = {}) {
    const tr = document.createElement('tr');
    tr.className = "border-b border-slate-700 hover:bg-slate-700/50 transition-colors item-row";
    tr.dataset.index = index;
    
    // ✅ Salva o endereço original (puro) no dataset da linha
    tr.dataset.originalEnd = data.end || data.item_end || '';

    // Valores padrão
    const tipo = data.tipo || 'FALTA';
    const cod = data.cod || '';
    const desc = data.desc || '';
    const lote = data.lote || '';
    const qtd = data.qtd || '';
    const obs = data.obs || '';
    const local = data.local || '';

    tr.innerHTML = `
        <td class="p-2">
            <select class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-white focus:ring-1 focus:ring-blue-500 outline-none item-type uppercase">
                <option value="FALTA" ${tipo === 'FALTA' ? 'selected' : ''}>FALTA</option>
                <option value="SOBRA" ${tipo === 'SOBRA' ? 'selected' : ''}>SOBRA</option>
                <option value="AVARIA" ${tipo === 'AVARIA' ? 'selected' : ''}>AVARIA</option>
                <option value="FALTA_INTERNA" ${tipo === 'FALTA_INTERNA' ? 'selected' : ''}>FALTA INT.</option>
            </select>
        </td>
        <td class="p-2"><input type="text" class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-white item-cod uppercase font-mono" placeholder="CÓD." value="${escapeHtml(cod)}"></td>
        <td class="p-2"><input type="text" class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-white item-desc uppercase" placeholder="DESCRIÇÃO" value="${escapeHtml(desc)}"></td>
        <td class="p-2"><input type="text" class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-white item-lote uppercase" placeholder="LOTE" value="${escapeHtml(lote)}"></td>
        <td class="p-2">
            <input type="number" class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-white item-qtd text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" placeholder="0" value="${qtd}">
        </td>
        <td class="p-2"><input type="text" class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-amber-200 placeholder-slate-600 item-obs uppercase" placeholder="EX: RASGADO" value="${escapeHtml(obs)}"></td>
        <td class="p-2"><input type="text" class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-white item-local uppercase" placeholder="LOCAL" value="${escapeHtml(local)}"></td>
        <td class="p-2 text-center">
            <button type="button" class="text-slate-500 hover:text-red-400 transition-colors btn-remove-item">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
        </td>
    `;

    tr.querySelector('.btn-remove-item').addEventListener('click', () => tr.remove());
    return tr;
}

export function extractItemsFromTable(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if(!tbody) return [];
    
    const rows = tbody.querySelectorAll('.item-row');
    const items = [];

    rows.forEach(row => {
        const tipo = row.querySelector('.item-type').value;
        const cod = row.querySelector('.item-cod').value.trim().toUpperCase();
        const desc = row.querySelector('.item-desc').value.trim().toUpperCase();
        const lote = row.querySelector('.item-lote').value.trim().toUpperCase();
        const qtd = parseInt(row.querySelector('.item-qtd').value) || 0;
        const obs = row.querySelector('.item-obs').value.trim().toUpperCase(); // ✨ Pega o detalhe
        const local = row.querySelector('.item-local').value.trim().toUpperCase();

        if (cod || desc || qtd > 0) {
            items.push({ 
                tipo, 
                item_cod: cod, 
                item_desc: desc, 
                item_lote: lote, 
                item_qtd: qtd, 
                item_obs: obs, 
                local: local,
                // ✅ Recupera o endereço puro salvo no dataset
                item_end: row.dataset.originalEnd || '' 
            });
        }
    });

    return items;
}

export function validateItems(items) {
    if (items.length === 0) return { valid: false, msg: "Adicione pelo menos um item na lista." };
    
    for (const item of items) {
        if (!item.item_cod) return { valid: false, msg: "Código do item é obrigatório em todas as linhas." };
        if (item.item_qtd <= 0) return { valid: false, msg: "Quantidade deve ser maior que zero." };
    }
    
    return { valid: true };
}

export function clearTable(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if(tbody) tbody.innerHTML = '';
}