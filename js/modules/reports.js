/**
 * ARQUIVO: js/modules/reports.js
 * DESCRIÇÃO: Centraliza lógica de exportação (Excel) e geração de Impressão (HTML/PDF).
 */

import { getFirestore, collection, query, where, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { showToast, printDocument, escapeHtml } from '../utils.js';
import { PATHS } from '../config.js';

// =========================================================
// EXPORTAÇÃO EXCEL (XLSX)
// =========================================================

export async function exportRncToXlsx(startDate, endDate) {
    try {
        showToast("Gerando relatório...", "info");
        const db = getFirestore();
        const q = query(collection(db, PATHS.occurrences), where('createdAt', '>=', startDate), where('createdAt', '<=', endDate), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        const rawData = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            d.jsDate = d.createdAt?.toDate ? d.createdAt.toDate() : new Date();
            if (d.type !== 'pallet_label_request' && d.status === 'concluido') rawData.push(d);
        });

        if (rawData.length === 0) { showToast("Nenhum dado encontrado.", "info"); return; }

        const exportData = [];

        rawData.forEach(d => {
            const headerData = {
                "DATA": d.jsDate.toLocaleDateString('pt-BR'), 
                "MÊS": d.jsDate.toLocaleString('pt-BR', { month: 'long' }).toUpperCase(), 
                "ANO": d.jsDate.getFullYear(),
                "ORIGEM / RESPONSÁVEL": d.infrator || '-', 
                "IDENTIFICADOR": d.ass_colab || '-', 
                "EMBARQUE": d.embarque || '-', 
                "CLIENTE": d.nf || '-', 
                "LIDER": d.ass_lider || '-', 
                "INVENTÁRIO": d.ass_inv || '-', 
                "OBS GERAL": d.obs || '-'
            };

            // ✨ LOGICA INTELIGENTE: Tenta separar Local de Endereço mesmo em dados antigos
            const processLocation = (fullLocal, savedAddress) => {
                let local = fullLocal || '-';
                let address = savedAddress || '';

                // Se NÃO tem endereço salvo separado, tenta achar um padrão (ex: 030-010 ou 10-20-30)
                if (!address) {
                    // Procura por sequências de números e traços
                    const match = local.match(/\b\d+-\d+(?:-\d+)?\b/); 
                    if (match) {
                        address = match[0]; // Captura o endereço encontrado (ex: 030-010)
                    }
                }

                // Limpa o Local removendo o endereço
                if (address && local.includes(address)) {
                    local = local.replace(address, '').trim();
                }

                return { local, address };
            };

            if (d.items && Array.isArray(d.items) && d.items.length > 0) {
                d.items.forEach(item => {
                    // Processa cada item
                    const { local, address } = processLocation(item.local || d.local, item.item_end || item.end);
                    
                    exportData.push({
                        ...headerData,
                        "LOCAL": local,      // ✅ Agora limpo até nos antigos
                        "OCORRENCIA": item.tipo || d.tipo || '-',
                        "CÓDIGO": item.item_cod || '-', 
                        "DESCRIÇÃO": item.item_desc || '-', 
                        "LOTE": item.item_lote || '-', 
                        "QTD (CX)": item.item_qtd || '0', 
                        "DETALHE DO ITEM": item.item_obs || '-', 
                        "ENDEREÇO": address || '-' // ✅ Preenchido via extração se necessário
                    });
                });
            } else {
                // Processa registro legado (sem array de itens)
                const { local, address } = processLocation(d.local, d.item_end || d.end);

                exportData.push({
                    ...headerData,
                    "LOCAL": local,
                    "OCORRENCIA": d.tipo || '-',
                    "CÓDIGO": d.item_cod || '-', 
                    "DESCRIÇÃO": d.item_desc || '-', 
                    "LOTE": d.item_lote || '-', 
                    "QTD (CX)": d.item_qtd || '0', 
                    "DETALHE DO ITEM": '-',
                    "ENDEREÇO": address || '-'
                });
            }
        });

        generateXlsx(exportData, `Relatorio_RD_${startDate.toLocaleDateString('pt-BR').replace(/\//g,'-')}`);
        showToast("Download iniciado!");

    } catch (e) {
        console.error(e);
        showToast("Erro ao gerar Excel.", "error");
    }
}

export async function exportPalletToXlsx(startDate, endDate) {
    try {
        const db = getFirestore();
        const q = query(collection(db, PATHS.occurrences), where('createdAt', '>=', startDate), where('createdAt', '<=', endDate), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        const rawData = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            d.jsDate = d.createdAt?.toDate ? d.createdAt.toDate() : new Date();
            if (d.type === 'pallet_label_request' && d.status === 'concluido') rawData.push(d);
        });

        if (rawData.length === 0) { showToast("Nenhuma etiqueta no período.", "info"); return; }
        
        const exportData = rawData.map(d => ({ 
            "ITEM": d.item || '-', 
            "LOTE": d.lote || '-', 
            "QTD": d.qtd || 0, 
            "EMBARQUE": d.embarque || '-',
            "CHK": d.box || d.checkout || '-',
            "DATA": d.jsDate.toLocaleString('pt-BR'), 
            "STATUS": "CONCLUÍDO" 
        }));
        
        generateXlsx(exportData, "Etiquetas_Palete");
        showToast("Download iniciado!");

    } catch (e) { console.error(e); showToast("Erro.", "error"); }
}

function generateXlsx(data, sheetName) {
    if(window.XLSX) {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 30));
        XLSX.writeFile(wb, `${sheetName}.xlsx`);
    } else { showToast("Erro: Biblioteca XLSX não carregada.", "error"); }
}

// =========================================================
// IMPRESSÃO / PDF (LAYOUT)
// =========================================================

export async function printRncById(id) {
    if (!id) return;
    try {
        const db = getFirestore();
        const docRef = doc(db, PATHS.occurrences, id);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            showToast("Registro não encontrado.", "error");
            return;
        }

        const data = docSnap.data();
        data.id = docSnap.id;
        generatePrintLayout(data);

    } catch (e) {
        console.error("Erro ao gerar relatório:", e);
        showToast("Erro ao gerar impressão.", "error");
    }
}

function generatePrintLayout(data) {
    const statusColor = data.status === 'concluido' ? '#10b981' : '#f59e0b';
    const statusText = data.status === 'concluido' ? 'CONCLUÍDO' : 'PENDENTE';
    
    const dateOpts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const dateStr = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('pt-BR', dateOpts) : new Date().toLocaleDateString('pt-BR');
    const ocurrenceDate = data.dataRef ? new Date(data.dataRef).toLocaleDateString('pt-BR', dateOpts) : dateStr;

    let productsHtml = '';
    const hasItemsArray = data.items && Array.isArray(data.items) && data.items.length > 0;

    if (hasItemsArray) {
        const rows = data.items.map(item => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px; font-size: 9px; font-weight: bold; color: #475569; text-transform: uppercase;">${escapeHtml(item.tipo)}</td>
                <td style="padding: 8px; font-family: monospace; font-weight: bold; font-size: 10px;">${escapeHtml(item.item_cod)}</td>
                <td style="padding: 8px; font-size: 10px;">${escapeHtml(item.item_desc)}</td>
                <td style="padding: 8px; font-size: 10px;">${escapeHtml(item.item_lote || '-')}</td>
                <td style="padding: 8px; font-weight: bold; text-align: center; color: #ef4444; font-size: 11px;">${item.item_qtd}</td>
                <td style="padding: 8px; font-size: 9px; font-weight: bold; color: #d97706; text-transform: uppercase;">${escapeHtml(item.item_obs || '-')}</td>
                <td style="padding: 8px; font-size: 9px; color: #64748b;">${escapeHtml(item.local)}</td>
            </tr>
        `).join('');

        productsHtml = `
            <div style="margin-top: 15px; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden;">
                <div style="background-color: #f1f5f9; padding: 8px 12px; font-size: 11px; font-weight: bold; color: #334155; border-bottom: 1px solid #cbd5e1; text-transform: uppercase;">
                    Detalhamento dos Itens (${data.items.length})
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                    <thead style="background-color: #f8fafc;">
                        <tr>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 10%;">TIPO</th>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 12%;">CÓDIGO</th>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0;">DESCRIÇÃO</th>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 12%;">LOTE</th>
                            <th style="text-align: center; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 6%;">QTD</th>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 15%;">DETALHE</th>
                            <th style="text-align: left; padding: 8px; border-bottom: 2px solid #e2e8f0; width: 12%;">LOCAL</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    } else {
        productsHtml = `
            <div style="padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; text-align:center; color: #64748b; font-size: 11px;">
                Registro antigo sem detalhamento de itens.
            </div>`;
    }

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>&nbsp;</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
            
            /* Força margem zero para esconder cabeçalhos do navegador */
            @page { 
                size: auto; 
                margin: 0mm !important; 
            }

            /* Garante que o conteúdo tenha margem interna segura */
            body { 
                font-family: 'Inter', sans-serif; 
                padding: 10mm 15mm; /* Margem segura para impressão A4 */
                color: #0f172a; 
                max-width: 900px; 
                margin: 0 auto; 
                background: white; 
            }
            
            .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 30px; }
            .logo h1 { font-size: 24px; font-weight: 800; letter-spacing: -1px; margin: 0; color: #0f172a; }
            .logo p { font-size: 12px; color: #64748b; margin: 2px 0 0 0; }
            .meta { text-align: right; font-size: 10px; color: #64748b; }
            .title-box { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
            .title-box h2 { font-size: 28px; font-weight: 800; margin: 0; text-transform: uppercase; color: #1e293b; }
            .status-badge { background-color: ${statusColor}; color: white; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
            .section { border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px; background: #fff; }
            .section-title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px; letter-spacing: 0.5px; }
            .info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
            .field label { display: block; font-size: 9px; color: #64748b; font-weight: bold; text-transform: uppercase; margin-bottom: 3px; }
            .field div { font-size: 13px; font-weight: 600; color: #1e293b; }
            .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px; margin-top: 50px; border-top: 2px solid #e2e8f0; padding-top: 30px; }
            .sig-block { text-align: center; }
            .sig-line { border-bottom: 1px solid #0f172a; margin-bottom: 8px; height: 30px; display: flex; align-items: flex-end; justify-content: center; font-family: 'Courier New', monospace; font-size: 12px; font-weight: bold; }
            .sig-label { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }
            
            /* Ajusta a margem do corpo para compensar a remoção da margem da página */
            @media print { 
                body { padding: 40px; margin: 0 auto; -webkit-print-color-adjust: exact; } 
                .no-print { display: none; } 
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="logo"><h1>AppLog</h1><p>Gestão de Estoque</p></div>
            <div class="meta">ID: ${data.id}<br>Emissão: ${new Date().toLocaleString('pt-BR')}<br>REF: ${(data.embarque || 'N/A')}</div>
        </div>
        <div class="title-box"><h2>Relatório de Divergência</h2><div class="status-badge">${statusText}</div></div>
        <div class="section"><div class="section-title">Informações Gerais</div><div class="info-grid"><div class="field"><label>Data Ocorrência</label><div>${ocurrenceDate}</div></div><div class="field"><label>Embarque</label><div>${escapeHtml(data.embarque || '-')}</div></div><div class="field"><label>Cliente / NF</label><div>${escapeHtml(data.nf || '-')}</div></div><div class="field"><label>Infrator / Origem</label><div>${escapeHtml(data.infrator || 'N/A')}</div></div></div></div>
        <div class="section"><div class="section-title">Detalhamento da Ocorrência</div>${productsHtml}</div>
        <div class="section">
            <div class="section-title">Observações Gerais / Relato</div>
            <div style="font-size: 12px; color: #334155; line-height: 1.4;">${escapeHtml(data.obs || 'Nenhuma observação registrada.')}</div>
        </div>
        <div class="signatures"><div class="sig-block"><div class="sig-line">${escapeHtml(data.ass_colab || '')}</div><div class="sig-label">Reportado Por</div></div><div class="sig-block"><div class="sig-line">${escapeHtml(data.ass_lider || '')}</div><div class="sig-label">Validação Liderança</div></div><div class="sig-block"><div class="sig-line">${escapeHtml(data.ass_inv || '')}</div><div class="sig-label">Conclusão Inventário</div></div></div>
        <script>window.onload = function() { window.print(); }</script>
    </body>
    </html>`;

    // ✅ CORREÇÃO: Abre a janela diretamente, sem passar pelo wrapper do utils.js
    // Isso evita que o cabeçalho seja duplicado.
    const printWindow = window.open('', '_blank');
    
    if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close(); // Importante para o navegador saber que terminou de carregar

        // Aguarda um momento para carregar estilos e imagens antes de imprimir
        printWindow.setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 500);
    } else {
        showToast("Popup bloqueado! Permita popups para imprimir.", "error");
    }
}