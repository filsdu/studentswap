# Student Marketplace Canada

This repository contains the front‑end source code for a student‑only
marketplace inspired by Facebook Marketplace.  The app is designed for
Canadian college and university students to buy, sell or donate
course‑related items such as textbooks, art kits, clothing and
electronics.  Unlike the big social networks, the marketplace restricts
registration to student email addresses ending in `.ca` to help keep
transactions within the academic community.

The project uses **Supabase** as a backend for authentication,
database access, real‑time messaging and file storage.  It is built
entirely with vanilla HTML, CSS (Tailwind) and JavaScript so it can be
deployed as a simple static site without a heavy build pipeline.  This
README explains how to configure your Supabase project, set up the
database schema, and deploy the site to Netlify.

## Features

- **Student‑only sign up & login** – Emails are validated client side to
  ensure they end in `.ca`.  Additional checks can be added if
  necessary.
- **Listings** – Students can post items with a title, description,
  price, category, photos (up to four), their school and program.  CRUD
  operations are supported and data is stored in Postgres via Supabase.
- **Search & filtering** – Filter by category, school, program,
  price range or free‑form search.  Sort by newest, price or views.
- **Saved items** – Authenticated users can save/unsave listings and
  review them later from the “Saved” tab.
- **Messaging** – In‑app real‑time chat between buyers and sellers
  backed by Supabase Realtime.  Conversations are identified using
  deterministic IDs derived from user IDs; filtering for specific
  `conversation_id` values leverages the `filter` parameter of
  Supabase’s `postgres_changes` API【195625100645152†L485-L521】.
- **Ratings & feedback** – Buyers can leave 1–5‑star ratings and an
  optional comment for listings.  Listing owners accumulate aggregate
  ratings on their profile.
- **Reporting & admin panel** – Users can flag suspicious listings.  A
  simple admin page lists flagged items and blocked users, enabling
  administrators to delete listings or unblock users.

## Getting Started

### 1. Create a Supabase project

1. Sign into the [Supabase dashboard](https://app.supabase.com) and
   create a new project.  Make a note of the **Project URL** and
   **Anon/Public API key** – you’ll need these later.
2. Under **Authentication → Settings**, ensure “Email confirmations”
   are enabled if you want users to verify their addresses before
   signing in.

### 2. Configure database tables

Open the SQL editor in the Supabase dashboard and run the following
queries to create the necessary tables.  Adjust column types as needed.

```sql
-- Users table to store profile information separate from auth.users
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  school_name text,
  program_name text,
  is_admin boolean default false,
  blocked boolean default false,
  rating_sum integer default 0,
  rating_count integer default 0
);

-- Listings table
create table if not exists public.listings (
  id uuid primary key,
  owner_id uuid references auth.users (id) on delete cascade,
  owner_name text,
  owner_email text,
  title text not null,
  description text,
  price numeric,
  category text,
  images jsonb default '[]',
  school text,
  program text,
  created_at timestamp with time zone default now(),
  view_count integer default 0,
  rating_sum integer default 0,
  rating_count integer default 0,
  is_deleted boolean default false
);

-- Saved listings for wishlists
create table if not exists public.saved_listings (
  user_id uuid references auth.users (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete cascade,
  created_at timestamp with time zone default now(),
  primary key (user_id, listing_id)
);

-- Messaging table for real‑time chat
create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id text not null,
  sender_id uuid references auth.users (id) on delete cascade,
  receiver_id uuid references auth.users (id) on delete cascade,
  content text,
  created_at timestamp with time zone default now()
);

-- Ratings table
create table if not exists public.ratings (
  id serial primary key,
  listing_id uuid references public.listings (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamp with time zone default now()
);

-- Reports table for flagging listings
create table if not exists public.reports (
  id serial primary key,
  listing_id uuid references public.listings (id) on delete cascade,
  user_id uuid references auth.users (id),
  reason text,
  created_at timestamp with time zone default now()
);
```

### 3. Enable Row Level Security (RLS) and policies

Supabase requires you to enable RLS on each table and define policies
describing who can access or modify data.  Below is a minimal policy
set to get you started:

```sql
-- Enable RLS
alter table public.users enable row level security;
alter table public.listings enable row level security;
alter table public.saved_listings enable row level security;
alter table public.messages enable row level security;
alter table public.ratings enable row level security;
alter table public.reports enable row level security;

-- Users: allow each user to select and update their own row
create policy "Users are viewable by themselves" on public.users
  for select using (auth.uid() = id or is_admin);
create policy "Users can update their own profile" on public.users
  for update using (auth.uid() = id);

-- Listings: allow reading all non‑deleted listings, inserting and
-- updating only by owners; admins can update/delete any listing
create policy "Anyone can view listings" on public.listings
  for select using (is_deleted = false or auth.uid() = owner_id or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));
create policy "Owners can insert listings" on public.listings
  for insert with check (auth.uid() = owner_id);
create policy "Owners can update their listings" on public.listings
  for update using (auth.uid() = owner_id);
create policy "Admins can modify any listing" on public.listings
  for update using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));

-- Saved listings: each user manages their own saved items
create policy "Users manage their saved listings" on public.saved_listings
  for all using (auth.uid() = user_id);

-- Messages: allow a user to insert and read messages where they are
-- either the sender or receiver.  Real‑time subscriptions are
-- filtered client side by conversation_id【195625100645152†L485-L521】.
create policy "Users can send messages" on public.messages
  for insert with check (auth.uid() = sender_id);
create policy "Users can view their conversations" on public.messages
  for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- Ratings: any authenticated user can insert a rating; everyone can
-- read ratings
create policy "Anyone can view ratings" on public.ratings for select using (true);
create policy "Authenticated can rate" on public.ratings for insert with check (auth.role() in ('authenticated'));

-- Reports: any authenticated user can file a report; admins can view
-- and delete them
create policy "Report insertion" on public.reports for insert with check (auth.role() = 'authenticated');
create policy "Admins view reports" on public.reports for select using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));
create policy "Admins delete reports" on public.reports for delete using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));
```

### 4. Configure storage

1. Navigate to **Storage** in the Supabase dashboard and create a
   bucket named `listing-images`.  Set it to **Public** so that
   uploaded photos can be viewed without authentication.
2. Optionally adjust caching settings; the app sets a default cache
   control of one hour when uploading.

### 5. Enable realtime replication for chat

The messaging UI uses Supabase’s Realtime **Postgres changes** API to
receive new messages.  In your project settings go to **Database →
Replication** and under the `supabase_realtime` publication ensure the
`messages` table is enabled.  The client subscribes using a
`filter` expression to receive only new inserts matching the current
conversation ID【195625100645152†L485-L521】.

### 6. Populate config.js

Duplicate `config.js` as `config.js` (the file in this repository is
named `config.js` and contains empty strings) and fill in your
Supabase credentials:

```js
// student-marketplace/config.js
export const config = {
  supabaseUrl: 'https://your-project-id.supabase.co',
  supabaseAnonKey: 'your-public-anon-key',
};
```

Make sure **never** to commit real keys to a public repository.  In
production you should configure these values as environment variables
in Netlify instead of hard‑coding them.

### 7. Local development

You can open `index.html` directly in your browser while developing.
Because the application uses ES modules and fetches external scripts
from CDNs, no bundling is required.  Ensure `config.js` points to
your Supabase project.

### 8. Deploy to Netlify

Deploying to Netlify is trivial because this is a static site:

1. Push this repository to GitHub (or another Git provider).
2. Log in to Netlify and **Import a project from Git**.  Select your
   repository and choose **No build command** since the site is static.
3. Under **Environment variables**, add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (or rename the variables in `config.js`
   accordingly).  Alternatively, commit a populated `config.js` if the
   repository is private.
4. Set the **Publish directory** to the root of the repository (where
   `index.html` resides).
5. Deploy your site.  You can also drag‑and‑drop the `student-marketplace`
   folder into Netlify’s upload area for an instant deploy.

## Contributing & extending

This project is intentionally built without a framework to make it easy
to understand the moving parts.  Tailwind CSS is loaded via a CDN and
can be replaced with any other styling methodology.  If you’d like
to add features – such as a more advanced rating system, additional
filters or improved admin tooling – you’re encouraged to fork the
repository and iterate.

## License

This repository is provided under the MIT license.  You are free to
modify and distribute it so long as the copyright notice is retained.
