import { openAIResponses } from "./openai.js";

function bytesFromBase64(value){
  const raw=atob(String(value||""));
  const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
  return out;
}

export function overlayCopy(client,title=""){
  const id=String(client?.id||"");
  const brand=id==="globalplay-streaming"?"GLOBAL PLAY":id==="ragnar-one"?"RAGNAR ONE":String(client?.name||"NEXUS").toUpperCase();
  const cleanTitle=String(title||"").replace(/\s+/g," ").trim().slice(0,42);
  return {brand,title:cleanTitle,cta:"DIGITE QUERO"};
}

async function composeBrandOverlay(env,bytes,client,title=""){
  if(!env.IMAGES)return {bytes,applied:false,reason:"images_binding_unavailable"};
  try{
    const copy=overlayCopy(client,title);
    let canvas=env.IMAGES.input(bytes).transform({width:1024,height:1536,fit:"cover"});
    const brand=env.IMAGES.text(copy.brand,{color:"#FFFFFF",size:64});
    const headline=copy.title?env.IMAGES.text(copy.title,{color:"#FFFFFF",size:52}):null;
    const cta=env.IMAGES.text(copy.cta,{color:"#FFFFFF",size:54});
    canvas=canvas.draw(brand,{left:64,top:58});
    if(headline)canvas=canvas.draw(headline,{left:64,bottom:176});
    canvas=canvas.draw(cta,{left:64,bottom:72});
    const response=await canvas.output({format:"image/jpeg",quality:90}).response();
    if(!response.ok)throw new Error("images_overlay_http_"+response.status);
    const out=new Uint8Array(await response.arrayBuffer());
    if(!out.byteLength||out.byteLength>12*1024*1024)throw new Error("images_overlay_invalid_bytes");
    return {bytes:out,applied:true,reason:""};
  }catch(error){
    return {bytes,applied:false,reason:String(error?.message||error).slice(0,120)};
  }
}

export function buildVisualPrompt(client, visualBrief="", variationSeed=""){
  const id=String(client?.id||"");
  const common=[
    "Create one premium vertical 9:16 social-media advertising artwork.",
    "No text, no words, no logos, no watermarks, no split screen, no collage.",
    "One coherent scene, strong focal point, expressive lighting, mobile-feed readability.",
    "Make the composition noticeably different from generic stock imagery.",
    "Variation seed: "+String(variationSeed||"new")
  ];
  if(id==="globalplay-streaming"){
    common.push(
      "Brand context: Global Play streaming entertainment.",
      "Until 12 October 2026 use an ORIGINAL family-friendly 3D animated/cartoon aesthetic.",
      "Show joyful family entertainment: vary parents, children, siblings, grandparents, pets, popcorn, cozy living rooms and playful actions.",
      "A television may be present and, when present, must show only generic original animated entertainment shapes/characters.",
      "Do not imitate Disney, Pixar or any named studio. No copyrighted characters, movie frames, sports-team marks or third-party brands.",
      "Avoid lonely sad men, empty televisions, dark depressing scenes and repeated sofa compositions."
    );
  }else if(id==="ragnar-one"){
    common.push(
      "Brand context: Ragnar One, an independent streaming brand.",
      "The SUBJECT must be ordinary streaming entertainment in a modern home: living room, television, friends, couple or family enjoying entertainment.",
      "Ragnar One's Nordic/Viking identity is BRANDING ONLY: premium dark palette, restrained metallic or wood texture, strong graphic framing and the RAGNAR ONE name added later by the brand overlay.",
      "Do NOT use Vikings, warriors, longships, shields, fjords, medieval cabins, axes, helmets, battle scenes, Nordic landscapes or Viking props as the subject or setting.",
      "Use generic original contemporary people only when useful; vary age, pose, framing and environment.",
      "Avoid repeating the same person sitting on a sofa and avoid literal Viking scenery."
    );
  }
  if(String(visualBrief||"").trim())common.push("Creative direction: "+String(visualBrief).slice(0,1200));
  return common.join(" ");
}

export async function generateOriginalMedia(env,client,postId,visualBrief="",options={}){
  if(!env.MEDIA)throw new Error("r2_unavailable");
  const origin=String(env.PUBLIC_BASE_URL||"").replace(/\/+$/,"");
  if(!origin)throw new Error("public_base_url_missing");
  const request=options.request||openAIResponses;
  const prompt=buildVisualPrompt(client,visualBrief,options.variationSeed||postId);
  const response=await request(env,client.id,{
    nexusPurpose:"media-generation",
    model:env.NEXUS_MEDIA_PLANNER_MODEL||"gpt-5.6-luna",
    input:[{role:"user",content:[{type:"input_text",text:prompt}]}],
    tools:[{
      type:"image_generation",
      model:env.NEXUS_IMAGE_MODEL||"gpt-image-2",
      quality:String(env.NEXUS_IMAGE_QUALITY||"medium"),
      size:"1024x1536",
      output_format:"jpeg"
    }],
    tool_choice:"required"
  });
  const item=(response?.output||[]).find(x=>x?.type==="image_generation_call"&&x?.result);
  if(!item?.result)throw new Error("image_generation_missing_result");
  const rawBytes=bytesFromBase64(item.result);
  if(!rawBytes.byteLength||rawBytes.byteLength>12*1024*1024)throw new Error("image_generation_invalid_bytes");
  const composed=await composeBrandOverlay(env,rawBytes,client,options.title||"");
  const bytes=composed.bytes;
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))]
    .map(byte=>byte.toString(16).padStart(2,"0")).join("");
  const key="posts/"+String(client.id)+"/"+String(postId)+"/generated-"+crypto.randomUUID()+".jpg";
  await env.MEDIA.put(key,bytes,{
    httpMetadata:{contentType:"image/jpeg",cacheControl:"public, max-age=31536000, immutable"},
    customMetadata:{clientId:String(client.id),postId:String(postId),kind:"openai-original-media"}
  });
  return {url:origin+"/media/"+key,key,fingerprint,brandingApplied:composed.applied,brandingError:composed.reason,promptVersion:"scene-grammar-v1"};
}
