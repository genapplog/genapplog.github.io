/**
 * ARQUIVO: js/modules/zpl-templates.js
 * DESCRIÇÃO: Contém apenas as strings e lógica de montagem do código ZPL.
 */

import { sanitizeForZpl } from '../utils.js';

// Função auxiliar interna para escala
function scaleY(value, labelLength) {
    const baseHeight = 1200;
    if (labelLength === baseHeight) return value;
    const scaled = Math.round((value / baseHeight) * labelLength);
    return scaled < 1 ? 1 : scaled;
}

export function getAmazonTemplate(dims, cdCode, cdInfo, nfKey, poNumber, currentBox, totalBoxes) {
    const volumeStr = `${currentBox}/${totalBoxes}`;
    const len = dims.ll;
    
    const safeInfo = {
        nome: sanitizeForZpl(cdInfo.nome),
        linha1: sanitizeForZpl(cdInfo.linha1),
        linha2: sanitizeForZpl(cdInfo.linha2),
        po: sanitizeForZpl(poNumber),
        nf: sanitizeForZpl(nfKey)
    };

    return `^XA^CI28^PW${dims.pw}^LL${dims.ll}^LH0,0^PO^FWB` +
           `^FO10,${scaleY(10,len)}^GB780,${scaleY(1180,len)},3^FS` +
           `^FO20,${scaleY(20,len)}^GB40,${scaleY(575,len)},3^FS^FO20,${scaleY(605,len)}^GB40,${scaleY(575,len)},3^FS` +
           `^FO70,${scaleY(20,len)}^GB220,${scaleY(575,len)},3^FS^FO70,${scaleY(605,len)}^GB220,${scaleY(575,len)},3^FS` +
           `^FO300,${scaleY(20,len)}^GB40,${scaleY(575,len)},3^FS^FO300,${scaleY(605,len)}^GB40,${scaleY(575,len)},3^FS` +
           `^FO350,${scaleY(20,len)}^GB180,${scaleY(575,len)},3^FS^FO350,${scaleY(605,len)}^GB180,${scaleY(575,len)},3^FS` +
           `^FO540,${scaleY(20,len)}^GB40,${scaleY(1160,len)},3^FS` +
           `^FO590,${scaleY(20,len)}^GB190,${scaleY(1160,len)},3^FS` +
           `^CFA,30^FO30,${scaleY(810,len)}^FH^FDENDEREÇO DE DESTINO:^FS` +
           `^CFA,20^FO90,${scaleY(990,len)}^FH^FDAMAZON CD: ${cdCode}^FS` +
           `^FO120,${scaleY(690,len)}^FH^FD${safeInfo.nome}^FS` +
           `^FO150,${scaleY(930,len)}^FH^FDCNPJ: ${cdInfo.cnpj}^FS` +
           `^FO180,${scaleY(965,len)}^FH^FDIE: ${cdInfo.ie}^FS` +
           `^FO210,${scaleY(665,len)}^FH^FD${safeInfo.linha1}^FS` +
           `^FO240,${scaleY(685,len)}^FH^FD${safeInfo.linha2}^FS` +
           `^CFA,30^FO30,${scaleY(170,len)}^FH^FDENDEREÇO FORNECEDOR:^FS` +
           `^CFA,20^FO150,${scaleY(135,len)}^FH^FDESTRADA MUNICIPAL LUIZ LOPES NETO, 21^FS` +
           `^FO180,${scaleY(305,len)}^FH^FDEXTREMA - MG, 37640-050^FS` +
           `^CFA,30^FO310,${scaleY(860,len)}^FH^FDPEDIDO DE COMPRA:^FS` +
           `^BY2,3,${scaleY(100,len)}^FO380,${scaleY(740,len)}^BC,${scaleY(110,len)},,,,N^FH^FD${safeInfo.po}^FS` +
           `^CFA,30^FO310,${scaleY(280,len)}^FH^FDNUMERO DE CAIXAS:^FS` +
           `^CFA,${scaleY(100,len)}^FO400,${scaleY(120,len)},^A0B,${scaleY(100,len)},${scaleY(70,len)}^FB400,1,0,C,0^FH^FD${volumeStr}\\&^FS` +
           `^CFA,30^FO550,${scaleY(950,len)}^FH^FDNOTA FISCAL:^FS` +
           `^BY2,3,${scaleY(130,len)}^FO620,${scaleY(80,len)}^BC,${scaleY(120,len)},,,,N^FH^FD${safeInfo.nf}^FS^XZ`;
}

export function getManualTemplate(data) {
    const safeData = {
        documento: sanitizeForZpl(data.documento),
        nf: sanitizeForZpl(data.nf),
        solicitante: sanitizeForZpl(data.solicitante),
        destinatario: sanitizeForZpl(data.destinatario),
        cidade: sanitizeForZpl(data.cidade),
        transportadora: sanitizeForZpl(data.transportadora),
        volAtual: data.volAtual,
        volTotal: data.volTotal
    };

    return `^XA^MMT^PW799^LL640^LS1` +
           `^FO15,55^GB767,4,4^FS^FO15,115^GB767,4,4^FS^FO15,270^GB767,4,4^FS^FO15,440^GB767,4,4^FS^FO15,520^GB767,4,4^FS` +
           `^FT15,45^A0N,34,33^FH\\^FDGENOMMA MG ^FS^FT15,80^A0N,17,16^FH\\^FDDOCUMENTO^FS` +
           `^FT100,105^A0N,34,33^FH\\^FD${safeData.documento}^FS^FT415,80^A0N,17,16^FH\\^FDSOLICITANTE^FS` +
           `^FT500,105^A0N,34,33^FH\\^FD${safeData.solicitante}^FS^FT15,155^A0N,17,16^FH\\^FDNOTA FISCAL^FS` +
           `^FT280,240^A0N,100,100^FH\\^FD${safeData.nf}^FS^FT15,305^A0N,17,16^FH\\^FDDESTINATARIO^FS` +
           `^FT15,355^A0N,34,33^FH\\^FD${safeData.destinatario}^FS^FT15,400^A0N,23,24^FH\\^FD${safeData.cidade}^FS` +
           `^FT15,510^A0N,34,33^FH\\^FD${safeData.transportadora}^FS^FT15,470^A0N,17,16^FH\\^FDTRANSPORTADOR^FS` +
           `^FT15,555^A0N,17,16^FH\\^FDVOLUMES^FS^FT55,595^A0N,34,33^FH\\^FD${safeData.volAtual} / ${safeData.volTotal} CAIXA^FS^XZ`;
}