import { Tables } from './lib/database.types.ts';
import { supabaseServiceRole } from './lib/supabase.ts';

const channel = supabaseServiceRole.channel('queue-service');

channel
  .on('presence', { event: 'sync' }, () => {
    const allConnects = channel.presenceState();
    console.log('connects', Object.keys(allConnects).length);
    if (Object.keys(allConnects).length === 0) {
      startService();
    }
  })
  .subscribe(async (status) => {
    if (status !== 'SUBSCRIBED') {
      return;
    }
    const presenceTrackStatus = await channel.track({
      online_at: new Date().toISOString(),
    });
    console.log('track', presenceTrackStatus);
  });

let isStarted = false;

async function startService() {
  if (isStarted) {
    return;
  }
  isStarted = true;

  supabaseServiceRole
    .channel('queue-message-changes')
    .on<Tables<'queue_message'>>(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'queue_message',
        filter: `queue_type=eq.github_action`,
      },
      async (payload) => {
        await dispatchMessage(payload.new);
      }
    )
    .subscribe();

  console.log('started');

  // Consume unprocessed data
  const { data } = await supabaseServiceRole
    .from('queue_message')
    .select('*')
    .eq('queue_type', 'github_action')
    .eq('ack', false)
    .order('id', { ascending: true });
  if (data?.length) {
    await Promise.all(
      data.map(async (record) => {
        await dispatchMessage(record);
      })
    );
    console.log(`delivered ${data.length} messages`);
  }
}

async function dispatchMessage(record: Tables<'queue_message'>) {
  if (record.ack || record.queue_type !== 'github_action') {
    return;
  }
  let endpoint = '';
  switch (record.queue) {
    case 'static-web':
      endpoint = Deno.env.get('AGENT_STATIC_WEB_ENDPOINT')!;
      break;
    default:
      throw new Error(`Invalid queue ${record.queue}(${record.id})`);
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(record),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': Deno.env.get('AGENT_AUTH_SECRET')!,
      },
    });
    if (!resp.ok) {
      console.error(
        `Error Fetching: id=${record.id}, queue=${record.queue}, status=${
          resp.status
        }, body=${resp.text()}`
      );
    }
  } catch (e) {
    console.error(`Error: id=${record.id}, queue=${record.queue}, err=${e}`);
  }
}
