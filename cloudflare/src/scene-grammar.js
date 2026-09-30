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
    scenes:["sala moderna com TV e luz aconchegante","home theater contemporâneo","sala elegante para noite de streaming","ambiente doméstico premium com TV ao fundo","sala de estar moderna com amigos","apartamento contemporâneo preparado para entretenimento"],
    compositions:["plano aberto cinematográfico","plano médio com profundidade","ângulo lateral elegante","plano frontal limpo","composição central minimalista","plano aberto com TV integrada ao ambiente"],
    characters:["casal adulto genérico","família adulta genérica","dupla de amigos adultos","homem adulto contemporâneo","mulher adulta contemporânea","nenhum personagem humano"],
    palettes:["preto, cobre e azul","grafite e dourado discreto","azul profundo e cinza aço","preto e âmbar","cinza escuro e cobre"],
    actions:["escolhendo o que assistir","compartilhando pipoca","relaxando durante uma sessão de streaming","conversando diante da TV","preparando uma noite de entretenimento","assistindo conteúdo em uma sala moderna"],
    props:["balde de pipoca","controle remoto","manta escura","caneca sem marca","almofadas discretas","textura de madeira ou metal apenas no acabamento visual"]
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

const HASHTAG_SETS={
  "globalplay-streaming":[
    "#GlobalPlay #DiversaoEmFamilia #Desenhos #SessaoEmCasa #Pipoca",
    "#GlobalPlay #Entretenimento #MomentoEmFamilia #Animacao #DicaDoDia",
    "#GlobalPlay #CinemaEmCasa #Familia #Diversao #OQueAssistir",
    "#GlobalPlay #Streaming #FimDeTarde #TempoEmFamilia #CurtaEmCasa"
  ],
  "ragnar-one":[
    "#RagnarOne #Streaming #CinemaEmCasa #Entretenimento #DicaDoDia",
    "#RagnarOne #Streaming #NoiteDeCinema #FilmesESeries #EmCasa",
    "#RagnarOne #Entretenimento #ExperienciaEmCasa #Cinema #OQueAssistir",
    "#RagnarOne #StreamingEmCasa #Entretenimento #Dicas #CinemaEmCasa"
  ]
};
const HOOKS={
  "globalplay-streaming":[
    "Qual desenho faria todo mundo sentar no sofá hoje?",
    "Tem noite que só pede pipoca e uma boa história.",
    "A melhor sessão é aquela que junta a família toda.",
    "Quem escolhe o que assistir aí na sua casa?",
    "Um sofá, pipoca e uma escolha que agrade todo mundo."
  ],
  "ragnar-one":[
    "Sua próxima noite de cinema pode ter outro clima.",
    "O que você escolheria para assistir hoje?",
    "Uma noite comum pode virar uma ótima sessão em casa.",
    "Pipoca pronta: qual vai ser a escolha de hoje?",
    "Tem noites que pedem uma atmosfera diferente."
  ]
};

export function diversifyHashtags(client,recent=[],seed=""){
  const sets=HASHTAG_SETS[String(client?.id||"")]||[];
  if(!sets.length)return "";
  for(let offset=0;offset<sets.length;offset++){
    const candidate=pick(sets,seed,offset);
    if((recent||[]).every(prior=>hashtagOverlap(candidate,prior.hashtags)<=0.5))return candidate;
  }
  return pick(sets,seed,sets.length+3);
}

export function diversifyHook(client,recent=[],seed=""){
  const hooks=HOOKS[String(client?.id||"")]||[];
  if(!hooks.length)return "";
  for(let offset=0;offset<hooks.length;offset++){
    const candidate=pick(hooks,seed,offset);
    if((recent||[]).every(prior=>tokenSimilarity(candidate,prior.hook)<0.78))return candidate;
  }
  return pick(hooks,seed,hooks.length+5);
}
