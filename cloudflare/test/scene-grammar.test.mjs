import test from "node:test";
import assert from "node:assert/strict";
import {diversifyScene,sceneSignature,repetitionReasons,hashtagOverlap} from "../src/scene-grammar.js";

test("scene grammar replaces a repeated Global Play composition",()=>{
  const repeated={scene:"sala clara com sofá e TV",composition:"plano aberto em diagonal",characters:"pais e duas crianças"};
  const out=diversifyScene({id:"globalplay-streaming"},repeated,[{...repeated,created_at:"2026-09-29T10:00:00Z"}],"post-2");
  assert.notEqual(sceneSignature(out),sceneSignature(repeated));
});

test("Ragnar grammar can vary away from man-on-sofa imagery",()=>{
  const out=diversifyScene({id:"ragnar-one"},{},[],"ragnar-7");
  assert.ok(out.scene);
  assert.ok(out.composition);
  assert.ok(out.characters);
  assert.doesNotMatch([out.scene,out.characters,out.action].join(" "),/mesmo homem sentado no sofá/i);
});

test("repetition policy covers scene 14d hook 21d and hashtag overlap 7d",()=>{
  const current={scene:"cabana",composition:"plano aberto",characters:"casal",hook:"Uma noite diferente começa aqui",hashtags:"#RagnarOne #Streaming #Nordico #Cinema"};
  const prior={...current,created_at:"2026-09-25T10:00:00Z",hashtags:"#RagnarOne #Streaming #Nordico #Aventura"};
  const reasons=repetitionReasons(current,[prior],"2026-09-29T10:00:00Z");
  assert.ok(reasons.includes("scene_composition_characters_14d"));
  assert.ok(reasons.includes("hook_structure_21d"));
  assert.ok(reasons.includes("hashtags_overlap_7d"));
  assert.ok(hashtagOverlap(current.hashtags,prior.hashtags)>0.5);
});
