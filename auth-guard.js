const config = window.HOUSEMATE_CONFIG || {};
if (config.supabaseUrl && config.supabaseAnonKey) {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.57.0');
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) window.location.replace('./auth.html');
  else {
    const { data: profile } = await supabase.from('profiles').select('status, display_name, role').eq('id', session.user.id).single();
    if (!profile || profile.status !== 'approved') window.location.replace('./auth.html?pending=1');
    else {
      window.housemateAuth = { supabase, session, profile };
      document.querySelector('.user-card strong').textContent = profile.display_name;
      document.querySelector('.user-card small').textContent = profile.role === 'admin' ? 'House admin' : 'Housemate';
      window.dispatchEvent(new CustomEvent('housemate-auth-ready', { detail: window.housemateAuth }));
    }
  }
}
