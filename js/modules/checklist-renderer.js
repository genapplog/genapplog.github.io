/**
 * ARQUIVO: js/modules/checklist-renderer.js
 * DESCRIÇÃO: Transforma JSON de regras em HTML de formulário.
 */

export function renderChecklist(containerId, rules) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!rules || Object.keys(rules).length === 0) {
        container.innerHTML = '<p class="text-slate-500 text-sm italic">Nenhum checklist específico configurado.</p>';
        return;
    }

    const title = document.createElement('h3');
    title.className = "text-sm font-bold text-slate-300 uppercase mb-4 border-b border-slate-700 pb-2";
    title.textContent = "Checklist Específico do Cliente";
    container.appendChild(title);

    // Renderiza Campos
    for (const [key, label] of Object.entries(rules)) {
        if (key === 'observacao') continue; // Pula observações, trata separado se quiser

        const div = document.createElement('div');
        div.className = "mb-3 flex items-center justify-between bg-slate-800/50 p-3 rounded border border-slate-700";
        
        div.innerHTML = `
            <span class="text-sm text-slate-300 font-medium">${label}</span>
            <div class="flex items-center gap-4">
                <label class="flex items-center cursor-pointer">
                    <input type="radio" name="chk_${key}" value="sim" class="form-radio text-emerald-500 w-4 h-4 focus:ring-emerald-500 bg-slate-900 border-slate-600">
                    <span class="ml-2 text-xs text-white">SIM</span>
                </label>
                <label class="flex items-center cursor-pointer">
                    <input type="radio" name="chk_${key}" value="nao" class="form-radio text-red-500 w-4 h-4 focus:ring-red-500 bg-slate-900 border-slate-600">
                    <span class="ml-2 text-xs text-white">NÃO</span>
                </label>
                <label class="flex items-center cursor-pointer">
                    <input type="radio" name="chk_${key}" value="na" class="form-radio text-slate-500 w-4 h-4 focus:ring-slate-500 bg-slate-900 border-slate-600">
                    <span class="ml-2 text-xs text-white">N/A</span>
                </label>
            </div>
        `;
        container.appendChild(div);
    }
}