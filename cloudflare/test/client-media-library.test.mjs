import test from "node:test";
import assert from "node:assert/strict";
import { useLibraryImageForPost } from "../src/posts.js";
import { clientCreativeReferenceNotes } from "../src/agent-runtime.js";

test("reference notes from the client library reach Creator guidance without D1 reads", async () => {
  let listed = 0;
  const env = {
    MEDIA: {
      async list() {
        listed += 1;
        return {
          objects: [
            { customMetadata:{ purpose:"reference", note:"Iluminação clara e foco em família." } },
            { customMetadata:{ purpose:"publish", note:"Não usar como referência." } },
            { customMetadata:{ purpose:"reference", note:"Iluminação clara e foco em família." } },
            { customMetadata:{ purpose:"reference", note:"Composição limpa, sem poluição visual." } }
          ]
        };
      }
    }
  };

  const notes = await clientCreativeReferenceNotes(env, "globalplay-streaming", 6);
  assert.equal(listed, 1);
  assert.deepEqual(notes, [
    "Iluminação clara e foco em família.",
    "Composição limpa, sem poluição visual."
  ]);
});

test("client-owned library image is staged publicly and returned to quality review", async () => {
  let row = {
    id:"post-1",
    client_id:"globalplay-streaming",
    scheduled_for:"2026-09-30T15:00:00.000Z",
    scheduled_hour:"12:00",
    status:"ready",
    approval_status:"approved",
    media_id:"",
    caption:"Legenda pronta",
    image_object_key:"",
    error:"",
    cost_usd:0,
    payload_json:JSON.stringify({
      imageUrl:"https://example.test/media/posts/old.jpg",
      qualityGates:{copyChief:"approved",designer:"approved"},
      visualReview:{version:"visual-review-v3",status:"approved",media:"https://example.test/media/posts/old.jpg",qualityScore:90}
    }),
    created_at:"2026-09-30 10:00:00",
    updated_at:"2026-09-30 10:00:00"
  };
  let put = null;

  const env = {
    MEDIA:{
      async get(key) {
        assert.equal(key,"library/globalplay-streaming/2026-09-30/photo.jpg");
        return {
          body:new Uint8Array([1,2,3]),
          size:3,
          httpMetadata:{contentType:"image/jpeg"},
          customMetadata:{purpose:"publish"}
        };
      },
      async put(key,body,metadata) { put={key,body,metadata}; },
      async delete() {}
    },
    DB:{
      prepare(sql) {
        const normalized=String(sql);
        let args=[];
        return {
          bind(...values){args=values;return this;},
          async first(){
            if(normalized.includes("FROM post_ledger")) return {...row};
            return null;
          },
          async run(){
            if(normalized.includes("UPDATE post_ledger")){
              row={
                ...row,
                status:String(args[2]),
                approval_status:String(args[3]),
                media_id:String(args[4]),
                caption:String(args[5]),
                image_object_key:String(args[6]),
                error:String(args[7]),
                payload_json:String(args[8])
              };
            }
            return {meta:{changes:1}};
          }
        };
      }
    }
  };

  const result=await useLibraryImageForPost(
    env,
    {id:"globalplay-streaming"},
    "post-1",
    "library/globalplay-streaming/2026-09-30/photo.jpg",
    "https://servidor.example"
  );

  assert.equal(result.ok,true);
  assert.match(put.key,/^posts\/globalplay-streaming\/post-1\/client-library-/);
  assert.equal(put.metadata.httpMetadata.contentType,"image/jpeg");
  assert.equal(result.post.approvalStatus,"approved");
  assert.equal(result.post.source,"client_library");
  assert.equal(result.post.qualityGates.copyChief,"pending");
  assert.equal(result.post.qualityGates.designer,"pending");
  assert.equal(result.post.visualReview,null);
  assert.match(result.post.imageUrl,/^https:\/\/servidor\.example\/media\/posts\//);
});
