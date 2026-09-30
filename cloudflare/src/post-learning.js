const CHECKPOINTS=Object.freeze([2,24,72]);

export function dueMetricCheckpoints(publishedAt,existing=[],now=new Date()){
  const publishedMs=Date.parse(String(publishedAt||""));
  const nowMs=(now instanceof Date?now:new Date(now)).getTime();
  if(!Number.isFinite(publishedMs)||!Number.isFinite(nowMs)||nowMs<publishedMs)return [];
  const ageHours=(nowMs-publishedMs)/3600000;
  const done=new Set((existing||[]).map(Number));
  return CHECKPOINTS.filter(hours=>ageHours>=hours&&!done.has(hours));
}

export function featureSignature(feature={}){
  return [
    feature.scene,feature.composition,feature.characters,feature.action
  ].map(v=>String(v||"").trim().toLowerCase()).filter(Boolean).join("|");
}

export async function upsertPostFeatures(env,feature={}){
  const postId=String(feature.postId||"").trim();
  const clientId=String(feature.clientId||"").trim();
  if(!postId||!clientId)return false;
  await env.DB.prepare(
    `INSERT INTO post_features(
      post_id,client_id,format,theme,hook,scene,composition,characters,palette,action,prop,cta,hashtags,scheduled_local_hour,payload_json,created_at,updated_at
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(post_id) DO UPDATE SET
      format=excluded.format,theme=excluded.theme,hook=excluded.hook,scene=excluded.scene,
      composition=excluded.composition,characters=excluded.characters,palette=excluded.palette,
      action=excluded.action,prop=excluded.prop,cta=excluded.cta,hashtags=excluded.hashtags,
      scheduled_local_hour=excluded.scheduled_local_hour,payload_json=excluded.payload_json,
      updated_at=CURRENT_TIMESTAMP`
  ).bind(
    postId,clientId,String(feature.format||"image"),String(feature.theme||"").slice(0,240),
    String(feature.hook||"").slice(0,500),String(feature.scene||"").slice(0,300),
    String(feature.composition||"").slice(0,300),String(feature.characters||"").slice(0,300),
    String(feature.palette||"").slice(0,180),String(feature.action||"").slice(0,300),
    String(feature.prop||"").slice(0,180),String(feature.cta||"").slice(0,400),
    String(feature.hashtags||"").slice(0,600),
    Number.isInteger(Number(feature.scheduledLocalHour))?Number(feature.scheduledLocalHour):null,
    JSON.stringify(feature.payload&&typeof feature.payload==="object"?feature.payload:{})
  ).run();
  return true;
}

export async function recentPostFeatures(env,clientId,days=60,limit=200){
  const result=await env.DB.prepare(
    `SELECT * FROM post_features
     WHERE client_id=?1 AND created_at>=datetime('now',?2)
     ORDER BY created_at DESC LIMIT ?3`
  ).bind(String(clientId),"-"+Math.max(1,Math.min(365,Number(days||60)))+" days",Math.max(1,Math.min(500,Number(limit||200)))).all();
  return result?.results||[];
}

export async function recentPublishedPostFeatures(env,clientId,days=60,limit=200){
  const result=await env.DB.prepare(
    `SELECT f.*
     FROM post_features f
     JOIN post_ledger p ON p.id=f.post_id
     WHERE f.client_id=?1 AND p.status='published'
       AND COALESCE(
         json_extract(CASE WHEN json_valid(p.payload_json) THEN p.payload_json ELSE '{}' END,'$.publishedAt'),
         p.updated_at,p.scheduled_for,p.created_at
       )>=datetime('now',?2)
     ORDER BY COALESCE(
       json_extract(CASE WHEN json_valid(p.payload_json) THEN p.payload_json ELSE '{}' END,'$.publishedAt'),
       p.updated_at,p.scheduled_for,p.created_at
     ) DESC LIMIT ?3`
  ).bind(String(clientId),"-"+Math.max(1,Math.min(365,Number(days||60)))+" days",Math.max(1,Math.min(500,Number(limit||200)))).all();
  return result?.results||[];
}

export async function recordMetricCheckpoints(env,{post,item,followersCount=0,previousFollowersCount=0,now=new Date()}={}){
  if(!post?.id||!item?.id)return {inserted:[],mature:false};
  const existingResult=await env.DB.prepare(
    "SELECT checkpoint_hours FROM post_metrics WHERE post_id=?1"
  ).bind(String(post.id)).all();
  const existing=(existingResult?.results||[]).map(row=>Number(row.checkpoint_hours));
  const publishedAt=post.payload?.publishedAt||post.updated_at||post.scheduled_for||post.created_at;
  const due=dueMetricCheckpoints(publishedAt,existing,now);
  if(!due.length)return {inserted:[],mature:false};

  const insights=item.insights&&typeof item.insights==="object"?item.insights:{};
  const inserted=[];
  for(const checkpoint of due){
    const id=String(post.id)+":"+String(checkpoint);
    const result=await env.DB.prepare(
      `INSERT OR IGNORE INTO post_metrics(
        id,post_id,client_id,checkpoint_hours,measured_at,views,reach,likes,comments,saved,shares,total_interactions,
        watch_time_ms,profile_visits,link_clicks,followers_count,follower_delta,payload_json,created_at
      ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,NULL,NULL,?14,?15,?16,CURRENT_TIMESTAMP)`
    ).bind(
      id,String(post.id),String(post.client_id),checkpoint,(now instanceof Date?now:new Date(now)).toISOString(),
      Math.max(0,Number(insights.views||0)),Math.max(0,Number(insights.reach||0)),
      Math.max(0,Number(item.likeCount||0)),Math.max(0,Number(item.commentsCount||0)),
      Math.max(0,Number(insights.saved||0)),Math.max(0,Number(insights.shares||0)),
      Math.max(0,Number(insights.total_interactions||0)),
      Number.isFinite(Number(insights.ig_reels_video_view_total_time))?Math.max(0,Number(insights.ig_reels_video_view_total_time)):null,
      Math.max(0,Number(followersCount||0)),Number(followersCount||0)-Number(previousFollowersCount||0),
      JSON.stringify({mediaId:String(item.id),mediaType:String(item.mediaType||""),permalink:String(item.permalink||"")})
    ).run();
    if(Number(result?.meta?.changes||0)>0)inserted.push(checkpoint);
  }
  return {inserted,mature:inserted.some(value=>value>=24)};
}

export const POST_METRIC_CHECKPOINTS=CHECKPOINTS;
