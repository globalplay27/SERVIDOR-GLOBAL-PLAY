import test from "node:test";
import assert from "node:assert/strict";
import { filterMasterGuidance } from "../src/master-workspace.js";

test("Master guidance delivers only all + selected agent directives",()=>{
  const guidance={
    directives:[
      {text:"global",appliesTo:["all"]},
      {text:"strategy",appliesTo:["estrategista"]},
      {text:"creator",appliesTo:["creator"]},
      {text:"publisher",appliesTo:["publisher"]}
    ],
    campaigns:[{id:"c1",title:"Campanha"}]
  };
  assert.deepEqual(
    filterMasterGuidance(guidance,"estrategista").directives.map(x=>x.text),
    ["global","strategy"]
  );
  assert.deepEqual(
    filterMasterGuidance(guidance,"creator").directives.map(x=>x.text),
    ["global","creator"]
  );
  assert.equal(filterMasterGuidance(guidance,"creator").campaigns.length,1);
});

test("Master guidance defaults missing appliesTo to all",()=>{
  const filtered=filterMasterGuidance({directives:[{text:"legacy"}],campaigns:[]},"designer");
  assert.deepEqual(filtered.directives.map(x=>x.text),["legacy"]);
});
