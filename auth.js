const config = window.HOUSEMATE_CONFIG || {}, setup = document.querySelector('#authSetup'), app = document.querySelector('#authApp'), status = document.querySelector('#authStatus'), login = document.querySelector('#authForm'), signup = document.querySelector('#signupForm'), pending = document.querySelector('#pendingView');
if (config.supabaseUrl && config.supabaseAnonKey) {
  setup.hidden = true; app.hidden = false;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2'), supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const show = target => { login.hidden = target !== 'login'; signup.hidden = target !== 'signup'; pending.hidden = target !== 'pending'; }, message = text => status.textContent = text;
  if (new URLSearchParams(location.search).has('pending')) show('pending');
  document.querySelector('#showSignUp').onclick = () => show('signup'); document.querySelector('#showLogin').onclick = () => show('login'); document.querySelector('#logOut').onclick = async () => { await supabase.auth.signOut(); show('login'); history.replaceState({}, '', './auth.html'); };
  document.querySelector('#loginForm').onsubmit = async event => { event.preventDefault(); const values = new FormData(event.currentTarget); message('Signing you in…'); const { error } = await supabase.auth.signInWithPassword({ email: values.get('email'), password: values.get('password') }); if (error) return message(error.message); window.location.replace('./index.html'); };
  document.querySelector('#registerForm').onsubmit = async event => { event.preventDefault(); const values = new FormData(event.currentTarget); message('Sending your request…'); const { error } = await supabase.auth.signUp({ email: values.get('email'), password: values.get('password'), options: { data: { display_name: values.get('name') } } }); if (error) return message(error.message); show('pending'); message(''); };
}
