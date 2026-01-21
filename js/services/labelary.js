/**
 * ARQUIVO: js/services/labelary.js
 * DESCRIÇÃO: Serviço responsável pela comunicação com a API Labelary.
 */

const BASE_API_URL = 'https://api.labelary.com/v1/printers/8dpmm/labels/';

/**
 * Obtém o Blob da imagem de preview de uma etiqueta ZPL
 */
export async function fetchLabelPreview(zplCode, sizeKey) {
    try {
        const response = await fetch(`${BASE_API_URL}${sizeKey}/0/`, { 
            method: 'POST', 
            headers: { 'Accept': 'image/png', 'Content-Type': 'application/x-www-form-urlencoded' }, 
            body: zplCode 
        });

        if (!response.ok) throw new Error(`Erro API: ${response.status}`);
        return await response.blob();
    } catch (error) {
        throw error;
    }
}

/**
 * Obtém o Blob do PDF de uma etiqueta ZPL
 */
export async function fetchLabelPdf(zplCode, sizeKey) {
    try {
        const response = await fetch(`${BASE_API_URL}${sizeKey}/`, { 
            method: 'POST', 
            headers: { 'Accept': 'application/pdf', 'Content-Type': 'application/x-www-form-urlencoded' }, 
            body: zplCode 
        });

        if (!response.ok) throw new Error(`Erro API: ${response.status}`);
        return await response.blob();
    } catch (error) {
        throw error;
    }
}