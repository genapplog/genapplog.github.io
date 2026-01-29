/**
 * ARQUIVO: js/modules/labels-data.js
 * DESCRIÇÃO: Dados estáticos (CDs, Dimensões) exclusivos do módulo de etiquetas.
 */

// Dados de CDs Amazon (Uppercase já tratado)
export const CD_DATA = { 
    "GRU5": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000367", ie: "241099810118 ", linha1: "CD PROLOGIS 3: AV. ANTONIO CANDIDO MACHADO", linha2: "3100 ANDAR 5, 07776415 - CAJAMAR - SP   " },
    "XBRA": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000448", ie: "241118709114 ", linha1: "CD PROLOGIS 2: AV. DR. JOAO ABDALLA 260   ", linha2: "BLOCO 400, 07776700 - CAJAMAR - SP      " },
    "XBRB": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000529", ie: "0842859-07   ", linha1: "RD BR-101 SUL, 3791BL C, GALPÃO 5, SL A   ", linha2: "54503010 - CABO DE SANTO AGOSTINHO - PE " },
    "XBRT": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000871", ie: "241134643114 ", linha1: "VIA DE ACESSO NORTE KM 38, 420, GALPÃO 07 ", linha2: "GLEBA A BLOCO 07, 07789100 CAJAMAR - SP " },
    "XBRZ": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000286", ie: "241115791117 ", linha1: "CD PROLOGIS 2: AV. DR. JOAO ABDALLA 260   ", linha2: "BLOCO 300, 07776700 CAJAMAR - SP        " },
    "CNF1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940000952", ie: "002668590054 ", linha1: "AVENIDA JUIZ MARCO TULIO ISAAC 7000       ", linha2: "32670250, BETIM - MG                    " },
    "BSB1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940001096", ie: "0774927400365", linha1: "RD DF, 290, KM 1.2 LOTE 13,14,15,16 E 17  ", linha2: "72501100, BRASILIA - DF                 " },
    "POA1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940001177", ie: "3820025709   ", linha1: "RUA DA PEDREIRA, 64, PAVILHÃO 05          ", linha2: "92480000, NOVA SANTA RITA - RS          " },
    "GIG1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940001410", ie: "11821987     ", linha1: "AV ARTHUR ANTONIO SENDAS, S/N AREA 6A     ", linha2: "25585021, SAO JOAO DE MERITI, RJ        " },
    "REC1": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "11543694000150", ie: "0920380-00   ", linha1: "RD BR 101 SUL, 9415, GALPÃO B             ", linha2: "54503010 - CABO DE SANTO AGOSTINHO - PE " },
    "FOR2": { nome: "AMAZON SERVICOS DE VAREJO DO BRASIL LTDA", cnpj: "15436940001681", ie: "61268801     ", linha1: "AV QUARTO ANEL VIARIO, 4343               ", linha2: "61880000, ITAITINGA - CE                    " } 
};

export const LABEL_DIMENSIONS = { 
    "4x6": { pw: 800, ll: 1200, aspect: "aspect-[2/3]" }, 
    "4x4": { pw: 800, ll: 800, aspect: "aspect-square" }, 
    "4x2": { pw: 800, ll: 400, aspect: "aspect-[2/1]" }, 
    "4x3.15": { pw: 800, ll: 640, aspect: "aspect-[10/8]" } 
};