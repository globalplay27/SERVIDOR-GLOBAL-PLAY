const COMMERCIAL_CLIENTS=new Set(["globalplay-streaming","ragnar-one"]);
const RESELLER_TERMS=/\b(?:adm|ultra|master|revenda|revendedor(?:es)?|cr[eé]dito(?:s)?|painel\s+adm|plano\s+adm)\b/i;

export function isCommercialClient(clientOrId){
  const id=typeof clientOrId==="string"?clientOrId:String(clientOrId?.id||"");
  return COMMERCIAL_CLIENTS.has(id);
}

export function commercialContentPolicy(clientOrId){
  const id=typeof clientOrId==="string"?clientOrId:String(clientOrId?.id||"");
  if(!COMMERCIAL_CLIENTS.has(id))return {enabled:false,clientId:id};
  return {
    enabled:true,
    clientId:id,
    audience:"cliente-final",
    resellerOffersAllowed:false,
    prohibitedTerms:["ADM","ULTRA","MASTER","revenda","revendedor","créditos"],
    pricingRule:"Use somente a oferta/preço configurado para esta conta. Nunca copiar, inferir ou misturar preço de outra conta.",
    cta:'Comente "QUERO" para saber mais.'
  };
}

export function hasResellerOffer(text=""){
  return RESELLER_TERMS.test(String(text||""));
}

export function commercialCopyAllowed(clientOrId,text=""){
  return !isCommercialClient(clientOrId)||!hasResellerOffer(text);
}

export function commercialPromptGuard(clientOrId){
  const p=commercialContentPolicy(clientOrId);
  if(!p.enabled)return "";
  return [
    "AUDIENCE RULE: sell only to end customers / cliente final.",
    "Never advertise reseller, reseller recruitment, ADM, ULTRA, MASTER, credits or reseller panels.",
    "PRICING RULE: use only the offer and price configured for this exact client account; never borrow or infer pricing from another account.",
    'Primary conversion CTA: Comente "QUERO" para saber mais.'
  ].join(" ");
}
