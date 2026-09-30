import { openAIResponses } from "./openai.js";

function bytesFromBase64(value){
  const raw=atob(String(value||""));
  const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
  return out;
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
      "Use an ORIGINAL premium Nordic cinematic mood with varied scenes.",
      "Rotate between fjord sunrise, warm cabin with fireplace, stormy coast, original longship silhouette, mountain lookout and modern Nordic interior.",
      "Use generic original adult characters only when useful; vary age, pose, framing and environment.",
      "Do not depict Ragnar Lothbrok, Vikings-series actors or characters, copied costumes, official logos, posters or recognizable protected scenes.",
      "Avoid repeating the same man sitting on a sofa."
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
  const bytes=bytesFromBase64(item.result);
  if(!bytes.byteLength||bytes.byteLength>12*1024*1024)throw new Error("image_generation_invalid_bytes");
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))]
    .map(byte=>byte.toString(16).padStart(2,"0")).join("");
  const key="posts/"+String(client.id)+"/"+String(postId)+"/generated-"+crypto.randomUUID()+".jpg";
  await env.MEDIA.put(key,bytes,{
    httpMetadata:{contentType:"image/jpeg",cacheControl:"public, max-age=31536000, immutable"},
    customMetadata:{clientId:String(client.id),postId:String(postId),kind:"openai-original-media"}
  });
  return {url:origin+"/media/"+key,key,fingerprint,promptVersion:"scene-grammar-v1"};
}
