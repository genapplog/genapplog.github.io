/**
 * ARQUIVO: js/services/view-loader.js
 * DESCRIÇÃO: Responsável por carregar e injetar os fragmentos HTML da pasta /pages
 */

export async function loadViews() {
    const views = [
        { file: './pages/home.html' },
        { file: './pages/dashboard.html' },
        { file: './pages/checklist.html' },
        { file: './pages/labels.html' },
        { file: './pages/rnc.html' },
        { file: './pages/profile.html' },
        { file: './pages/settings.html' }
    ];

    try {
        let container = document.querySelector('#main-content > div');

        // ROBUSTEZ: Cria o container se ele não existir (foi apagado do index.html)
        if (!container) {
            const mainContent = document.getElementById('main-content');
            if (!mainContent) {
                console.error("❌ ERRO CRÍTICO: Elemento #main-content não encontrado.");
                return;
            }
            container = document.createElement('div');
            container.className = "p-4 md:p-10 pb-20"; 
            mainContent.appendChild(container);
        }

        // Carrega todos os arquivos HTML em paralelo
        const responses = await Promise.all(views.map(v => fetch(v.file)));
        
        for (const [index, response] of responses.entries()) {
            if (!response.ok) throw new Error(`Falha ao carregar ${views[index].file} (Status: ${response.status})`);
        }

        const htmls = await Promise.all(responses.map(r => r.text()));

        // Injeta o conteúdo acumulando com o que já existe (ex: modais globais se houver)
        container.innerHTML = htmls.join('') + container.innerHTML; 
        
        console.log("📦 Views carregadas com sucesso.");
        
    } catch (error) {
        console.error("Erro no ViewLoader:", error);
        const main = document.getElementById('main-content');
        if (main) main.innerHTML = `<div class="p-10 text-red-500 font-bold">Erro de Interface: ${error.message}</div>`;
    }
}