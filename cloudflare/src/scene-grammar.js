function norm(value){
  return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
}
function hash(value){
  let h=2166136261;
  for(const ch of String(value||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return h>>>0;
}
function pick(list,seed,offset=0){return list[(hash(seed)+offset)%list.length];}

const GRAMMARS={
  "globalplay-streaming":{
    scenes:["sala clara com sofá e TV","sala colorida com almofadas e pipoca","home theater familiar aconchegante","sala de estar iluminada pela manhã","noite de cinema em família com luz quente","sala moderna com brinquedos discretos"],
    compositions:["plano aberto em diagonal","plano médio frontal","ângulo lateral dinâmico","plano aberto com profundidade","composição triangular centrada na família","plano médio com TV ao fundo"],
    characters:["pais e duas crianças","mãe, pai e uma criança","avó com duas crianças","dois irmãos com um responsável","família com cachorro","família com gato"],
    palettes:["azul, roxo e amarelo vibrantes","azul petróleo e laranja quente","roxo, rosa e azul luminosos","azul royal e amarelo pipoca","verde água, azul e dourado suave"],
    actions:["rindo e escolhendo o que assistir","compartilhando pipoca e reagindo à TV","apontando animados para a tela","se acomodando para uma sessão em família","comemorando juntos uma escolha de entretenimento"],
    props:["balde de pipoca","controle remoto","almofadas coloridas","manta aconchegante","copo de refrigerante sem marca","brinquedo genérico ao fundo"]
  },
  "ragnar-one":{
    scenes:["fiorde ao amanhecer","cabana nórdica com lareira","costa nórdica em tempestade","mirante de montanha com neblina","interior nórdico moderno e premium","cais com silhueta de embarcação nórdica original"],
    compositions:["plano aberto cinematográfico","plano médio com profundidade","silhueta em contraluz","ângulo baixo épico e limpo","plano lateral com luz dramática","composição central minimalista"],
    characters:["casal adulto genérico","homem adulto genérico em pé","mulher adulta genérica em pé","dupla de amigos adultos","personagem adulto visto de costas","nenhum personagem humano"],
    palettes:["azul frio e dourado","cinza aço e âmbar","azul profundo e verde aurora","preto, cobre e azul","cinza pedra e fogo quente"],
    actions:["observando a paisagem","preparando uma noite de entretenimento","entrando na cabana aquecida","caminhando em direção ao fiorde","contemplando a tempestade à distância","relaxando em ambiente nórdico moderno"],
    props:["caneca sem marca","manta de lã","lanterna metálica genérica","mapa abstrato sem texto","escudo geométrico original sem símbolos protegidos","madeira e pedra como elementos de cenário"]
  }
};

export function sceneSignature(feature={}){
  return [feature.scene,feature.composition,feature.characters].map(norm).filter(Boolean).join("|");
}

export function tokenSimilarity(a,b){
  const A=new Set(norm(a).split(" ").filter(Boolean));
  const B=new Set(norm(b).split(" ").filter(Boolean));
  if(!A.size||!B.size)return 0;
  let both=0; for(const x of A)if(B.has(x))both++;
  return both/new Set([...A,...B]).size;
}

export function hashtagOverlap(a,b){
  const tags=value=>new Set(String(value||"").toLowerCase().match(/#[\p{L}\p{N}_]+/gu)||[]);
  const A=tags(a),B=tags(b);
  if(!A.size||!B.size)return 0;
  let both=0;for(const x of A)if(B.has(x))both++;
  return both/Math.min(A.size,B.size);
}

export function diversifyScene(client,feature={},recentFeatures=[],seed=""){
  const grammar=GRAMMARS[String(client?.id||"")];
  if(!grammar)return {...feature};
  const recentSignatures=new Set((recentFeatures||[]).map(sceneSignature).filter(Boolean));
  const candidate={...feature};
  if(sceneSignature(candidate)&&!recentSignatures.has(sceneSignature(candidate)))return candidate;
  for(let attempt=0;attempt<24;attempt++){
    const fresh={
      ...candidate,
      scene:pick(grammar.scenes,seed+"scene",attempt),
      composition:pick(grammar.compositions,seed+"composition",attempt*3+1),
      characters:pick(grammar.characters,seed+"characters",attempt*5+2),
      palette:candidate.palette||pick(grammar.palettes,seed+"palette",attempt*7+3),
      action:candidate.action||pick(grammar.actions,seed+"action",attempt*11+4),
      prop:candidate.prop||pick(grammar.props,seed+"prop",attempt*13+5)
    };
    if(!recentSignatures.has(sceneSignature(fresh)))return fresh;
  }
  return {
    ...candidate,
    scene:pick(grammar.scenes,seed+"fallback",17),
    composition:pick(grammar.compositions,seed+"fallback",19),
    characters:pick(grammar.characters,seed+"fallback",23)
  };
}

export function repetitionReasons(current,recent=[],now=new Date()){
  const reasons=[];
  const nowMs=(now instanceof Date?now:new Date(now)).getTime();
  for(const prior of recent||[]){
    const created=Date.parse(String(prior.created_at||prior.createdAt||""));
    const ageDays=Number.isFinite(created)?(nowMs-created)/86400000:999;
    if(ageDays<=14&&sceneSignature(current)&&sceneSignature(current)===sceneSignature(prior)){
      reasons.push("scene_composition_characters_14d"); break;
    }
  }
  for(const prior of recent||[]){
    const created=Date.parse(String(prior.created_at||prior.createdAt||""));
    const ageDays=Number.isFinite(created)?(nowMs-created)/86400000:999;
    if(ageDays<=21&&tokenSimilarity(current.hook,prior.hook)>=0.78){
      reasons.push("hook_structure_21d"); break;
    }
  }
  for(const prior of recent||[]){
    const created=Date.parse(String(prior.created_at||prior.createdAt||""));
    const ageDays=Number.isFinite(created)?(nowMs-created)/86400000:999;
    if(ageDays<=7&&hashtagOverlap(current.hashtags,prior.hashtags)>0.5){
      reasons.push("hashtags_overlap_7d"); break;
    }
  }
  return reasons;
}
