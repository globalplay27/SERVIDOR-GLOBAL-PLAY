import test from "node:test";
import assert from "node:assert/strict";
import { openAIResponses, tokenUsageToday } from "../src/openai.js";

function envAtUsage(usedTokens){
  return {
    OPENAI_API_KEY_SHARED:"test-key",
    NEXUS_OPENAI_DAILY_TOKEN_LIMIT:"30000",
    DB:{
      prepare(sql){
        const api={
          async run(){return {meta:{changes:0}};},
          bind(){
            return {
              async first(){
                if(sql.includes("FROM token_usage")) return {
                  input_tokens:Math.max(0,usedTokens-1000),
                  output_tokens:Math.min(1000,usedTokens),
                  used_tokens:usedTokens,
                  calls:4,last_model:"gpt-5.6-luna",updated_at:"2026-09-29 20:00:00"
                };
                if(sql.includes("FROM clients WHERE id")) return {
                  id:"globalplay-streaming",name:"Global Play",niche:"streaming",instagram:"@globalplay_streaming",
                  status:"online",config_json:"{}",created_at:"",updated_at:""
                };
                if(sql.includes("openai_runtime_status")) return {status:"ok",detail:"",updated_at:""};
                return null;
              },
              async run(){return {meta:{changes:0}};}
            };
          },
          async first(){return null;}
        };
        return api;
      }
    }
  };
}

test("visual review cannot consume the strategic token reserve",async()=>{
  const env=envAtUsage(25000);
  const usage=await tokenUsageToday(env,"globalplay-streaming");
  assert.equal(usage.blocked,false);
  await assert.rejects(
    openAIResponses(env,"globalplay-streaming",{nexusPurpose:"visual-review",input:"inspect"}),
    error=>error?.message==="openai_visual_budget_reserved"
  );
});
