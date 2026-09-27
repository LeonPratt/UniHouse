// Shared Pub Golf scorecards. Database RPCs enforce membership and score bounds.
const pubGolfState = { games: [], teams: [], scores: [], gameId: null, teamId: null, drafts: new Map(), loading: false, pendingLoad: false };
const pubGolfEl = id => document.getElementById(id);
const pubGolfEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const pubGolfClient = () => window.housemateAuth?.supabase;
const pubGolfCurrentGame = () => pubGolfState.games.find(game => game.id === pubGolfState.gameId);
const pubGolfTeams = () => pubGolfState.teams.filter(team => team.game_id === pubGolfState.gameId);
const pubGolfDraftKey = (gameId, teamId, hole) => `${gameId}:${teamId}:${hole}`;

function pubGolfStandings(game, teams) {
  const entries = teams.map(team => {
    const scores = pubGolfState.scores.filter(score => score.team_id === team.id);
    return {
      team,
      completed: scores.filter(score => score.strokes !== null).length,
      total: scores.reduce((sum, score) => sum + Number(score.strokes || 0) + Number(score.penalties || 0), 0)
    };
  });
  entries.sort((a, b) => b.completed - a.completed || a.total - b.total || a.team.position - b.team.position);
  return entries.map((entry, index) => {
    const previous = entries[index - 1];
    const same = previous && previous.completed === entry.completed && previous.total === entry.total;
    entry.rank = same ? previous.rank : index + 1;
    entry.tied = entries.some(other => other !== entry && other.completed === entry.completed && other.total === entry.total);
    entry.final = entry.completed === game.hole_count;
    return entry;
  });
}

function renderPubGolf() {
  const select = pubGolfEl('pubGolfGameSelect');
  const content = pubGolfEl('pubGolfContent');
  const deleteButton = pubGolfEl('pubGolfDeleteButton');
  if (!pubGolfState.games.length) {
    select.innerHTML = '<option value="">No games yet</option>';
    select.disabled = true;
    deleteButton.hidden = true;
    content.innerHTML = '<p class="empty-state">No Pub Golf games yet. Create one to start scoring.</p>';
    return;
  }
  if (!pubGolfState.games.some(game => game.id === pubGolfState.gameId)) pubGolfState.gameId = pubGolfState.games[0].id;
  const game = pubGolfCurrentGame();
  select.disabled = false;
  select.innerHTML = pubGolfState.games.map(item => `<option value="${pubGolfEscape(item.id)}"${item.id === game.id ? ' selected' : ''}>${pubGolfEscape(item.title)}</option>`).join('');
  deleteButton.hidden = game.created_by !== window.housemateAuth?.session?.user?.id && window.housemateAuth?.profile?.role !== 'admin';
  const teams = pubGolfTeams();
  if (!teams.some(team => team.id === pubGolfState.teamId)) pubGolfState.teamId = teams[0]?.id || null;
  const standing = pubGolfStandings(game, teams);
  const allDone = standing.every(entry => entry.final);
  const selected = teams.find(team => team.id === pubGolfState.teamId);
  const scores = new Map(pubGolfState.scores.filter(score => score.team_id === selected?.id).map(score => [score.hole_number, score]));
  content.innerHTML = `
    <div class="pub-golf-heading"><div><h2>${pubGolfEscape(game.title)}</h2><p>${game.hole_count} hole${game.hole_count === 1 ? '' : 's'} · ${teams.length} teams</p></div><span class="pub-golf-phase">${allDone ? 'Final standings' : 'Provisional standings'}</span></div>
    <div class="pub-golf-leaderboard" aria-label="Pub Golf leaderboard">
      ${standing.map(entry => `<div class="pub-golf-standing"><strong>${entry.tied ? 'T' : ''}${entry.rank}</strong><span>${pubGolfEscape(entry.team.name)}</span><span>${entry.completed}/${game.hole_count} holes</span><b>${entry.total} strokes</b></div>`).join('')}
    </div>
    <div class="pub-golf-score-heading"><div><h3>Enter scores</h3><p>Leave strokes blank until a hole is played. Penalty strokes add to the total.</p></div><label>Team<select id="pubGolfTeamSelect">${teams.map(team => `<option value="${pubGolfEscape(team.id)}"${team.id === selected?.id ? ' selected' : ''}>${pubGolfEscape(team.name)}</option>`).join('')}</select></label></div>
    <div class="pub-golf-scorecard">${Array.from({ length: game.hole_count }, (_, index) => {
      const hole = index + 1;
      const score = scores.get(hole);
      const draft = pubGolfState.drafts.get(pubGolfDraftKey(game.id, selected?.id, hole));
      return `<form class="pub-golf-hole" data-hole="${hole}"><strong>Hole ${hole}</strong><label>Strokes<input name="strokes" type="number" inputmode="numeric" min="1" max="1000" step="1" placeholder="—" value="${pubGolfEscape(draft?.strokes ?? score?.strokes ?? '')}" aria-label="Hole ${hole} strokes" /></label><label>Penalties<input name="penalties" type="number" inputmode="numeric" min="0" max="1000" step="1" value="${pubGolfEscape(draft?.penalties ?? score?.penalties ?? 0)}" aria-label="Hole ${hole} penalty strokes" /></label><span class="pub-golf-hole-total">${score?.strokes == null ? 'Unscored' : `${Number(score.strokes) + Number(score.penalties)} total`}</span><button class="secondary-button" type="submit">Save</button></form>`;
    }).join('')}</div>`;
}

async function loadPubGolf() {
  const client = pubGolfClient();
  if (!client) return;
  if (pubGolfState.loading) { pubGolfState.pendingLoad = true; return; }
  pubGolfState.loading = true;
  try {
    const gamesResult = await client.from('pub_golf_games').select('id,title,hole_count,created_by,created_at').order('created_at', { ascending: false });
    if (gamesResult.error) throw gamesResult.error;
    pubGolfState.games = gamesResult.data || [];
    if (!pubGolfState.games.some(game => game.id === pubGolfState.gameId)) pubGolfState.gameId = pubGolfState.games[0]?.id || null;
    if (pubGolfState.gameId) {
      const teamsResult = await client.from('pub_golf_teams').select('id,game_id,name,position').eq('game_id', pubGolfState.gameId).order('position');
      if (teamsResult.error) throw teamsResult.error;
      pubGolfState.teams = teamsResult.data || [];
      const teamIds = pubGolfState.teams.map(team => team.id);
      const scoresResult = teamIds.length
        ? await client.from('pub_golf_scores').select('team_id,hole_number,strokes,penalties').in('team_id', teamIds)
        : { data: [], error: null };
      if (scoresResult.error) throw scoresResult.error;
      pubGolfState.scores = scoresResult.data || [];
    } else {
      pubGolfState.teams = [];
      pubGolfState.scores = [];
    }
    renderPubGolf();
  } catch (error) {
    pubGolfEl('pubGolfContent').textContent = `Couldn’t load Pub Golf: ${error.message}. Check that migration 005 has been applied.`;
  } finally {
    pubGolfState.loading = false;
    if (pubGolfState.pendingLoad) { pubGolfState.pendingLoad = false; void loadPubGolf(); }
  }
}

pubGolfEl('pubGolfCreateButton').addEventListener('click', () => {
  if (!pubGolfClient()) return toast('Sign in to create a game.');
  pubGolfEl('pubGolfCreateForm').reset();
  pubGolfEl('pubGolfCreateModal').showModal();
});
pubGolfEl('pubGolfGameSelect').addEventListener('change', event => {
  pubGolfState.gameId = event.target.value;
  pubGolfState.teamId = null;
  void loadPubGolf();
});
pubGolfEl('pubGolfContent').addEventListener('change', event => {
  if (event.target.id !== 'pubGolfTeamSelect') return;
  pubGolfState.teamId = event.target.value;
  renderPubGolf();
});
pubGolfEl('pubGolfContent').addEventListener('input', event => {
  const form = event.target.closest('.pub-golf-hole');
  if (!form) return;
  pubGolfState.drafts.set(pubGolfDraftKey(pubGolfState.gameId, pubGolfState.teamId, form.dataset.hole), {
    strokes: form.elements.strokes.value,
    penalties: form.elements.penalties.value
  });
});
pubGolfEl('pubGolfCreateForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const fields = new FormData(form);
  const names = String(fields.get('teams')).split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  if (names.length < 2 || names.length > 20 || names.some(name => name.length > 60) || new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) {
    return toast('Enter 2 to 20 different team names, one per line.');
  }
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const { data, error } = await pubGolfClient().rpc('create_pub_golf_game', {
      p_title: String(fields.get('title')).trim(), p_hole_count: Number(fields.get('holes')), p_team_names: names
    });
    if (error) throw error;
    pubGolfState.gameId = data;
    pubGolfState.teamId = null;
    pubGolfEl('pubGolfCreateModal').close();
    await loadPubGolf();
    toast('Pub Golf game created.');
  } catch (error) { toast(`Couldn’t create game: ${error.message}`); }
  finally { button.disabled = false; }
});
pubGolfEl('pubGolfContent').addEventListener('submit', async event => {
  const form = event.target.closest('.pub-golf-hole');
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const strokesText = form.elements.strokes.value.trim();
  const penaltiesText = form.elements.penalties.value.trim();
  const strokes = strokesText === '' ? null : Number(strokesText);
  const penalties = penaltiesText === '' ? 0 : Number(penaltiesText);
  if ((strokes !== null && (!Number.isInteger(strokes) || strokes < 1 || strokes > 1000)) || !Number.isInteger(penalties) || penalties < 0 || penalties > 1000 || (strokes === null && penalties !== 0)) {
    return toast('Enter strokes before penalties, or leave strokes blank with 0 penalties to clear the hole.');
  }
  const gameId = pubGolfState.gameId;
  const teamId = pubGolfState.teamId;
  const draftKey = pubGolfDraftKey(gameId, teamId, form.dataset.hole);
  const submittedDraft = { strokes: form.elements.strokes.value, penalties: form.elements.penalties.value };
  pubGolfState.drafts.set(draftKey, submittedDraft);
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await pubGolfClient().rpc('set_pub_golf_score', {
      p_game_id: gameId, p_team_id: teamId, p_hole_number: Number(form.dataset.hole), p_strokes: strokes, p_penalties: penalties
    });
    if (error) throw error;
    const latestDraft = pubGolfState.drafts.get(draftKey);
    if (latestDraft?.strokes === submittedDraft.strokes && latestDraft?.penalties === submittedDraft.penalties) pubGolfState.drafts.delete(draftKey);
    await loadPubGolf();
    toast('Score saved.');
  } catch (error) { toast(`Couldn’t save score: ${error.message}`); button.disabled = false; }
});
pubGolfEl('pubGolfDeleteButton').addEventListener('click', async () => {
  const game = pubGolfCurrentGame();
  if (!game || !window.confirm(`Delete “${game.title}” and all its scores?`)) return;
  const button = pubGolfEl('pubGolfDeleteButton');
  button.disabled = true;
  try {
    const { data, error } = await pubGolfClient().from('pub_golf_games').delete().eq('id', game.id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Only the game creator or a house admin can delete this game.');
    for (const key of pubGolfState.drafts.keys()) if (key.startsWith(`${game.id}:`)) pubGolfState.drafts.delete(key);
    pubGolfState.gameId = null;
    pubGolfState.teamId = null;
    await loadPubGolf();
    toast('Pub Golf game deleted.');
  } catch (error) { toast(`Couldn’t delete game: ${error.message}`); }
  finally { button.disabled = false; }
});

window.addEventListener('housemate-auth-ready', () => { void loadPubGolf(); });
if (window.housemateAuth) void loadPubGolf();
