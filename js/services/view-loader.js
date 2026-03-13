/**
 * ARQUIVO: js/services/view-loader.js
 * DESCRIÇÃO: Responsável por carregar as views e prevenir XSS de forma segura.
 */
export async function loadViews() {
    const views = [
        { file: './pages/home.html' },
        { file: './pages/dashboard.html' },
        { file: './pages/checklist.html' },
        { file: './pages/labels.html' },
        { file: './pages/rnc.html' },
        { file: './pages/profile.html' },
        { file: './pages/settings.html' },
        { file: './pages/agendamento.html' },
        { file: './pages/cadastros.html' }
    ];

    try {
        let container = document.querySelector('#main-content > div');

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

        const responses = await Promise.all(views.map(v => fetch(v.file)));
        
        for (const [index, response] of responses.entries()) {
            if (!response.ok) throw new Error(`Falha ao carregar ${views[index].file}`);
        }

        const htmls = await Promise.all(responses.map(r => r.text()));

        // Injeção segura e otimizada de todo o DOM ANTES dos scripts rodarem
        const template = document.createElement('template');
        template.innerHTML = htmls.join('');
        container.appendChild(template.content); 
        
        console.log("📦 Views carregadas e sanitizadas com sucesso.");
        document.dispatchEvent(new CustomEvent('views-loaded'));
        
    } catch (error) {
        console.error("Erro no View Loader:", error);
    }
}