/*
 * Student Marketplace – Front‑end application
 *
 * This file contains all of the client‑side logic for the Student Marketplace.
 * It leverages Supabase as a backend for authentication, real‑time database
 * operations, storage and row‑level subscriptions.  The app is deliberately
 * built using vanilla JavaScript and Tailwind CSS to keep the codebase
 * accessible to learners without requiring a complex build pipeline.  Each
 * page is defined as an HTML template in index.html and is rendered
 * dynamically based on the URL hash.
 */

import { config } from './config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm';

// Initialise the Supabase client using the project URL and anon key.  See
// config.js for configuration values.
const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

// Application state.  These variables are updated throughout the app and
// reference the currently authenticated user, any real‑time subscriptions and
// cached data such as saved listings.
let currentUser = null;        // supabase.auth.User object
let userProfile = null;        // row from users table
let savedListingIds = new Set(); // IDs of listings saved by the current user
let currentChatSubscription = null; // active realtime subscription for chat

/**
 * Toggle visibility between the static home landing content and the dynamic
 * content container.  The landing sections (hero, features, categories,
 * testimonials, CTA) live in the #home-content element, while all SPA
 * pages are rendered inside the #content element.  When showing dynamic
 * pages we hide the home content; when returning to the home route we hide
 * the SPA container.  This helper prevents duplication and simplifies
 * individual render functions.
 */
function showHomeContent() {
  const homeEl = document.getElementById('home-content');
  const contentEl = document.getElementById('content');
  if (homeEl) homeEl.style.display = '';
  if (contentEl) contentEl.style.display = 'none';
}

function showDynamicContent() {
  const homeEl = document.getElementById('home-content');
  const contentEl = document.getElementById('content');
  if (homeEl) homeEl.style.display = 'none';
  if (contentEl) contentEl.style.display = '';
}

/**
 * Utility: Show a notification bar at the top of the screen.  The bar is
 * coloured based on the type of message (success, error or info) and fades
 * automatically after a short delay.
 *
 * @param {string} message  Text to display to the user
 * @param {string} [type]   One of 'success', 'error' or 'info'
 */
function showNotification(message, type = 'info') {
  const bar = document.getElementById('notification');
  if (!bar) return;
  bar.textContent = message;
  bar.className = `fixed top-0 left-0 right-0 z-50 p-3 text-center font-medium`;
  switch (type) {
    case 'success':
      bar.classList.add('bg-green-500', 'text-white');
      break;
    case 'error':
      bar.classList.add('bg-red-500', 'text-white');
      break;
    default:
      bar.classList.add('bg-blue-500', 'text-white');
  }
  bar.classList.remove('hidden');
  // Hide after 4 seconds
  setTimeout(() => {
    bar.classList.add('hidden');
  }, 4000);
}

/**
 * Check whether the supplied email address appears to be a valid Canadian
 * student email.  We simply require the domain to end in `.ca`.  You can
 * refine this check to match specific institutions if desired.
 *
 * @param {string} email The email address to validate
 * @returns {boolean} Whether the email seems valid
 */
function validStudentEmail(email) {
  const parts = (email || '').split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1].toLowerCase();
  return domain.endsWith('.ca');
}

/**
 * Parse the URL hash into a route and optional ID.  We use a simple
 * convention: #/route/id.  For example, #/listing/123 will parse to
 * ['listing', '123'] and #/new-listing will parse to ['new-listing', null].
 *
 * @returns {[string, string|null]} An array containing the route and id
 */
function parseHash() {
  let hash = window.location.hash || '#/home';
  hash = hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  const route = parts[0] || 'home';
  const id = parts.length > 1 ? parts[1] : null;
  return [route, id];
}

/**
 * Render the navigation bar based on authentication state and whether the
 * current user is an admin.  This function rebuilds the entire nav element
 * whenever called.
 */
/**
 * Render the navigation bar and action buttons based on authentication state.
 * The deep‑seek layout uses two containers: an unordered list (#nav-bar) for
 * standard links and a div (#nav-buttons) for primary/secondary actions.  This
 * function clears both containers and repopulates them with the appropriate
 * elements.  When the user is not logged in, we show login and sign‑up
 * buttons.  When logged in, we display links for saved listings, messages,
 * profile, and a primary button for creating a new listing.  A logout
 * button ends the session.
 */
function renderNav() {
  const navBar = document.getElementById('nav-bar');
  const navButtons = document.getElementById('nav-buttons');
  if (!navBar || !navButtons) return;
  // Clear existing elements
  navBar.innerHTML = '';
  navButtons.innerHTML = '';

  // Helper to append a list item with an anchor to the nav bar
  const addNavLink = (text, href) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    li.appendChild(a);
    navBar.appendChild(li);
  };

  // Primary navigation links – these mirror the DeepSeek landing page
  addNavLink('Home', '#/home');
  addNavLink('Marketplace', '#/marketplace');
  addNavLink('Categories', '#categories');
  addNavLink('How It Works', '#how-it-works');
  addNavLink('Testimonials', '#testimonials');

  if (currentUser) {
    // Authenticated actions
    // New listing – primary button
    const newListing = document.createElement('a');
    newListing.href = '#/new-listing';
    newListing.className = 'btn btn-primary';
    newListing.innerHTML = '<i class="fas fa-plus-circle"></i> New Listing';
    navButtons.appendChild(newListing);
    // Saved listings
    const savedLink = document.createElement('a');
    savedLink.href = '#/saved';
    savedLink.className = 'btn btn-outline';
    savedLink.innerHTML = '<i class="fas fa-heart"></i> Saved';
    navButtons.appendChild(savedLink);
    // Messages
    const msgLink = document.createElement('a');
    msgLink.href = '#/messages';
    msgLink.className = 'btn btn-outline';
    msgLink.innerHTML = '<i class="fas fa-comments"></i> Messages';
    navButtons.appendChild(msgLink);
    // Profile
    const profileLink = document.createElement('a');
    profileLink.href = '#/profile';
    profileLink.className = 'btn btn-outline';
    profileLink.innerHTML = '<i class="fas fa-user"></i> Profile';
    navButtons.appendChild(profileLink);
    // Admin link if applicable
    if (userProfile && userProfile.is_admin) {
      const adminLink = document.createElement('a');
      adminLink.href = '#/admin';
      adminLink.className = 'btn btn-outline';
      adminLink.innerHTML = '<i class="fas fa-tools"></i> Admin';
      navButtons.appendChild(adminLink);
    }
    // Logout button
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn-outline';
    logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Log Out';
    logoutBtn.addEventListener('click', async () => {
      await supabase.auth.signOut();
      showNotification('Logged out successfully', 'success');
      window.location.hash = '#/home';
    });
    navButtons.appendChild(logoutBtn);
  } else {
    // Not authenticated – show Login and Sign Up
    const loginBtn = document.createElement('a');
    loginBtn.href = '#/login';
    loginBtn.className = 'btn btn-primary';
    loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    navButtons.appendChild(loginBtn);
    const signupBtn = document.createElement('a');
    signupBtn.href = '#/signup';
    signupBtn.className = 'btn btn-outline';
    signupBtn.innerHTML = '<i class="fas fa-user-plus"></i> Sign Up';
    navButtons.appendChild(signupBtn);
  }
}

/**
 * Main router: render the appropriate page based on the current URL hash.
 * If the user attempts to access a protected route without authentication
 * (e.g. creating a listing), they are redirected to the login page.  When a
 * page is rendered, any previously subscribed realtime channels are cleaned
 * up to prevent memory leaks.
 */
async function handleRoute() {
  // Clean up any existing realtime subscription when navigating away
  if (currentChatSubscription) {
    try {
      await currentChatSubscription.unsubscribe();
    } catch (err) {
      // ignore errors
    }
    currentChatSubscription = null;
  }

  const [route, id] = parseHash();
  switch (route) {
    case 'login':
      renderLoginPage();
      break;
    case 'signup':
      // Render the login page then programmatically open the sign‑up tab
      renderLoginPage();
      // Wait a tick for the template to be inserted
      setTimeout(() => {
        const signupTab = document.querySelector('[data-auth-tab="signup"]');
        if (signupTab) signupTab.click();
      }, 0);
      break;
    case 'marketplace':
      renderMarketplacePage();
      break;
    case 'new-listing':
      if (!currentUser) {
        showNotification('Please log in to create listings.', 'error');
        window.location.hash = '#/login';
      } else {
        renderNewListingPage(id);
      }
      break;
    case 'listing':
      renderListingDetailsPage(id);
      break;
    case 'profile':
      renderProfilePage(id);
      break;
    case 'messages':
      if (!currentUser) {
        showNotification('Please log in to view messages.', 'error');
        window.location.hash = '#/login';
      } else {
        renderMessagesPage(id);
      }
      break;
    case 'saved':
      if (!currentUser) {
        showNotification('Please log in to view saved listings.', 'error');
        window.location.hash = '#/login';
      } else {
        renderSavedPage();
      }
      break;
    case 'admin':
      if (!currentUser || !userProfile || !userProfile.is_admin) {
        showNotification('You do not have access to that page.', 'error');
        window.location.hash = '#/home';
      } else {
        renderAdminPage();
      }
      break;
    case 'categories':
    case 'how-it-works':
    case 'testimonials':
      // These routes are anchors within the landing page.  Render the home
      // content, then smooth‑scroll to the relevant section.
      renderHomePage();
      // Use a timeout to ensure the browser has time to update the DOM
      setTimeout(() => {
        const anchorId = route;
        const el = document.getElementById(anchorId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      }, 0);
      break;
    case 'home':
    default:
      renderHomePage();
  }
}

/**
 * Populate the login/sign‑up page and attach event listeners for switching
 * between tabs and submitting the forms.  After a successful sign in, the
 * user is redirected to their previous page or the home page.
 */
function renderLoginPage() {
  const content = document.getElementById('content');
  const template = document.getElementById('login-template');
  if (!content || !template) return;
  // Ensure the SPA container is visible and the landing content hidden
  showDynamicContent();
  content.innerHTML = '';
  const node = template.content.cloneNode(true);
  content.appendChild(node);

  // Tab toggling
  const tabs = content.querySelectorAll('.auth-tab');
  const signinForm = content.querySelector('#signin-form');
  const signupForm = content.querySelector('#signup-form');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-auth-tab');
      tabs.forEach((b) => b.classList.remove('bg-blue-600', 'text-white'));
      tabs.forEach((b) => b.classList.add('bg-blue-100', 'text-blue-600'));
      btn.classList.remove('bg-blue-100', 'text-blue-600');
      btn.classList.add('bg-blue-600', 'text-white');
      if (tab === 'signin') {
        signinForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
      } else {
        signupForm.classList.remove('hidden');
        signinForm.classList.add('hidden');
      }
    });
  });

  // Sign in handler
  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = content.querySelector('#signin-email').value.trim();
    const password = content.querySelector('#signin-password').value;
    if (!email || !password) return;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      showNotification(error.message || 'Failed to sign in.', 'error');
    } else {
      showNotification('Signed in successfully!', 'success');
      // On sign in, Supabase will trigger the auth state change listener
      // which will set currentUser and userProfile.  Redirect to home
      window.location.hash = '#/home';
    }
  });

  // Sign up handler
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = content.querySelector('#signup-fullname').value.trim();
    const email = content.querySelector('#signup-email').value.trim();
    const password = content.querySelector('#signup-password').value;
    const school = content.querySelector('#signup-school').value.trim();
    const program = content.querySelector('#signup-program').value.trim();
    if (!fullName || !email || !password || !school) {
      showNotification('Please fill out all required fields.', 'error');
      return;
    }
    if (!validStudentEmail(email)) {
      showNotification('Please use a valid .ca student email address.', 'error');
      return;
    }
    // Create user with metadata so we can retrieve profile details later
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          school_name: school,
          program_name: program,
        },
      },
    });
    if (error) {
      showNotification(error.message || 'Sign up failed.', 'error');
    } else {
      // Insert a row in users table with extra details.  The auth.signUp
      // response may not contain a user if email confirmations are
      // enabled, so we wrap in a try/catch.  We'll insert when the
      // session becomes available in the auth state change handler too.
      const user = data?.user;
      if (user) {
        try {
          await supabase.from('users').insert({
            id: user.id,
            email: email,
            full_name: fullName,
            school_name: school,
            program_name: program,
            is_admin: false,
            blocked: false,
            rating_sum: 0,
            rating_count: 0,
          });
        } catch (err) {
          // ignore duplicate insertion
        }
      }
      showNotification('Account created! Check your email for a confirmation link.', 'success');
      // After sign up, remain on login page so they can log in once
      // their email is confirmed
    }
  });
}

/**
 * Render the home page.  This page displays a grid of listings and includes
 * controls for searching, filtering and sorting.  Saved listings are marked
 * with a coloured heart icon if the user is logged in.  Filters trigger a
 * re‑query of the listings table.
 */
async function renderHomePage() {
  // The home landing page is a static template in index.html (#home-content).
  // When navigating to home we hide the SPA content container and reveal
  // the landing content.  All dynamic controls (search, filters) exist on
  // the marketplace page rather than the home page.  See renderMarketplacePage()
  // for listing functionality.
  showHomeContent();
}

/**
 * Render the marketplace page.  This page provides search, filtering and
 * sorting controls and displays a grid of listing cards.  Saved listings
 * are highlighted with a heart icon when the user is logged in.  The
 * implementation is largely borrowed from the original home page but
 * separated into its own function to keep the landing page static.
 */
async function renderMarketplacePage() {
  const content = document.getElementById('content');
  const template = document.getElementById('marketplace-template');
  if (!content || !template) return;
  // Ensure the SPA container is visible and the landing content hidden
  showDynamicContent();
  content.innerHTML = '';
  const node = template.content.cloneNode(true);
  content.appendChild(node);

  // Preload saved listing IDs if logged in
  if (currentUser) {
    await loadSavedListingIds();
  }

  // Elements
  const searchInput = content.querySelector('#search-input');
  const categoryFilter = content.querySelector('#category-filter');
  const schoolFilter = content.querySelector('#school-filter');
  const programFilter = content.querySelector('#program-filter');
  const priceMinInput = content.querySelector('#price-min');
  const priceMaxInput = content.querySelector('#price-max');
  const sortOrder = content.querySelector('#sort-order');
  const listingsGrid = content.querySelector('#listings-grid');

  // Debounce helper to prevent re‑querying on every keystroke
  let searchTimeout;
  const triggerSearch = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadListings, 300);
  };

  // Attach event listeners
  searchInput.addEventListener('input', triggerSearch);
  categoryFilter.addEventListener('change', loadListings);
  schoolFilter.addEventListener('input', triggerSearch);
  programFilter.addEventListener('input', triggerSearch);
  priceMinInput.addEventListener('input', triggerSearch);
  priceMaxInput.addEventListener('input', triggerSearch);
  sortOrder.addEventListener('change', loadListings);

  // Initial load
  loadListings();

  /**
   * Query the listings table applying current filters and render the
   * results.  Any errors are surfaced via a notification.
   */
  async function loadListings() {
    listingsGrid.innerHTML = '';
    // Build query
    let query = supabase.from('listings').select('*').eq('is_deleted', false);
    const searchTerm = searchInput.value.trim();
    const category = categoryFilter.value;
    const school = schoolFilter.value.trim();
    const program = programFilter.value.trim();
    const minPrice = parseFloat(priceMinInput.value);
    const maxPrice = parseFloat(priceMaxInput.value);
    const sort = sortOrder.value;
    if (category) {
      query = query.eq('category', category);
    }
    if (school) {
      query = query.ilike('school', `%${school}%`);
    }
    if (program) {
      query = query.ilike('program', `%${program}%`);
    }
    if (searchTerm) {
      // Use OR across title and description
      query = query.ilike('title', `%${searchTerm}%`);
      // Note: supabase doesn't support OR across fields in the same call of .ilike.
      // To match description as well, we'll refine after the fetch below.
    }
    if (!isNaN(minPrice)) {
      query = query.gte('price', minPrice);
    }
    if (!isNaN(maxPrice)) {
      query = query.lte('price', maxPrice);
    }
    // Sorting
    switch (sort) {
      case 'lowprice':
        query = query.order('price', { ascending: true });
        break;
      case 'highprice':
        query = query.order('price', { ascending: false });
        break;
      case 'mostviewed':
        query = query.order('view_count', { ascending: false });
        break;
      case 'newest':
      default:
        query = query.order('created_at', { ascending: false });
    }
    const { data, error } = await query.limit(100);
    if (error) {
      showNotification('Failed to load listings.', 'error');
      return;
    }
    // If searching across both title and description, filter results locally
    let results = data || [];
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      results = results.filter(
        (item) =>
          item.title.toLowerCase().includes(lower) ||
          (item.description && item.description.toLowerCase().includes(lower))
      );
    }
    renderListings(results);
  }

  /**
   * Render a set of listing cards in the grid.  Each card displays
   * thumbnail image(s), title, price, school and program.  Clicking a card
   * navigates to its detail page.  A save/unsave button is available when
   * logged in.
   *
   * @param {Array} listings The listings to render
   */
  function renderListings(listings) {
    listingsGrid.innerHTML = '';
    if (!listings || listings.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-center text-gray-500 mt-8 col-span-full';
      empty.textContent = 'No listings found.';
      listingsGrid.appendChild(empty);
      return;
    }
    listings.forEach((listing) => {
      const card = document.createElement('div');
      card.className = 'bg-white rounded shadow hover:shadow-lg transition cursor-pointer flex flex-col';
      // Image
      const img = document.createElement('img');
      img.className = 'h-40 w-full object-cover rounded-t';
      const firstImage = Array.isArray(listing.images) && listing.images.length > 0 ? listing.images[0] : null;
      img.src = firstImage || 'https://placehold.co/400x300?text=No+Image';
      card.appendChild(img);
      // Info container
      const info = document.createElement('div');
      info.className = 'p-4 flex-1 flex flex-col';
      // Title
      const title = document.createElement('h3');
      title.className = 'text-lg font-semibold mb-1 truncate';
      title.textContent = listing.title;
      info.appendChild(title);
      // Price
      const price = document.createElement('p');
      price.className = 'text-blue-600 font-bold mb-1';
      price.textContent = listing.price ? `CAD $${Number(listing.price).toFixed(2)}` : 'Free';
      info.appendChild(price);
      // School / program
      const schoolLine = document.createElement('p');
      schoolLine.className = 'text-sm text-gray-600';
      schoolLine.textContent = listing.school;
      info.appendChild(schoolLine);
      const programLine = document.createElement('p');
      programLine.className = 'text-sm text-gray-600 mb-2';
      programLine.textContent = listing.program || '';
      info.appendChild(programLine);
      // Save button if logged in
      if (currentUser) {
        const saveBtn = document.createElement('button');
        const saved = savedListingIds.has(listing.id);
        saveBtn.innerHTML = saved ? '❤️' : '🤍';
        saveBtn.title = saved ? 'Remove from saved' : 'Save listing';
        saveBtn.className = 'self-start text-2xl focus:outline-none';
        saveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          // Toggle saved state
          if (savedListingIds.has(listing.id)) {
            // unsave
            await supabase
              .from('saved_listings')
              .delete()
              .match({ user_id: currentUser.id, listing_id: listing.id });
            savedListingIds.delete(listing.id);
            saveBtn.innerHTML = '🤍';
            saveBtn.title = 'Save listing';
          } else {
            await supabase
              .from('saved_listings')
              .insert({ user_id: currentUser.id, listing_id: listing.id });
            savedListingIds.add(listing.id);
            saveBtn.innerHTML = '❤️';
            saveBtn.title = 'Remove from saved';
          }
        });
        info.appendChild(saveBtn);
      }
      card.appendChild(info);
      card.addEventListener('click', () => {
        window.location.hash = `#/listing/${listing.id}`;
      });
      listingsGrid.appendChild(card);
    });
  }
}

/**
 * Load the set of listing IDs that the current user has saved.  These are
 * stored in the global savedListingIds set so the UI can display hearts on
 * saved items.  Called when rendering home or saved pages.
 */
async function loadSavedListingIds() {
  savedListingIds.clear();
  if (!currentUser) return;
  const { data, error } = await supabase
    .from('saved_listings')
    .select('listing_id')
    .eq('user_id', currentUser.id);
  if (!error && data) {
    data.forEach((row) => savedListingIds.add(row.listing_id));
  }
}

/**
 * Render the page for creating or editing a listing.  If an ID is supplied
 * then the existing listing is fetched and its data pre‑populated for editing.
 * Only the owner of a listing can edit it.  When the form is submitted the
 * listing and any images are saved to Supabase.  Upon success the user is
 * redirected to the listing detail page.
 *
 * @param {string|null} id Optional listing ID to edit
 */
async function renderNewListingPage(id = null) {
  const content = document.getElementById('content');
  const template = document.getElementById('new-listing-template');
  if (!content || !template) return;
  // Ensure the SPA container is visible and the landing content hidden
  showDynamicContent();
  content.innerHTML = '';
  const node = template.content.cloneNode(true);
  content.appendChild(node);
  const form = content.querySelector('#listing-form');
  const titleInput = content.querySelector('#listing-title');
  const descriptionInput = content.querySelector('#listing-description');
  const priceInput = content.querySelector('#listing-price');
  const categorySelect = content.querySelector('#listing-category');
  const imagesInput = content.querySelector('#listing-images');
  const schoolInput = content.querySelector('#listing-school');
  const programInput = content.querySelector('#listing-program');
  const formTitle = content.querySelector('#listing-form-title');

  let isEditing = false;
  let existingListing = null;
  if (id) {
    // Editing existing listing
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      showNotification('Unable to load listing for editing.', 'error');
      return;
    }
    if (data.owner_id !== currentUser.id) {
      showNotification('You do not have permission to edit this listing.', 'error');
      window.location.hash = '#/home';
      return;
    }
    isEditing = true;
    existingListing = data;
    formTitle.textContent = 'Edit Listing';
    // Prefill fields
    titleInput.value = existingListing.title;
    descriptionInput.value = existingListing.description;
    priceInput.value = existingListing.price;
    categorySelect.value = existingListing.category;
    schoolInput.value = existingListing.school;
    programInput.value = existingListing.program || '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    const price = parseFloat(priceInput.value);
    const category = categorySelect.value;
    const school = schoolInput.value.trim();
    const program = programInput.value.trim();
    const files = imagesInput.files;
    if (!title || !description || !school || isNaN(price)) {
      showNotification('Please fill in all required fields.', 'error');
      return;
    }
    // When editing we keep existing images unless new ones are provided.  If
    // the user selects files we replace the images array entirely.
    let imageUrls = existingListing ? existingListing.images || [] : [];
    const listingId = isEditing ? existingListing.id : crypto.randomUUID();
    // Handle uploads if files provided
    if (files && files.length > 0) {
      imageUrls = [];
      const bucket = 'listing-images';
      // Ensure the bucket exists and is public.  See README for set‑up.
      for (let i = 0; i < Math.min(files.length, 4); i++) {
        const file = files[i];
        const path = `${listingId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(path, file, { cacheControl: '3600', upsert: false });
        if (uploadError) {
          showNotification(`Failed to upload ${file.name}.`, 'error');
          continue;
        }
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
        if (urlData && urlData.publicUrl) {
          imageUrls.push(urlData.publicUrl);
        }
      }
    }
    // Prepare listing object
    const listingRecord = {
      id: listingId,
      owner_id: currentUser.id,
      owner_name: userProfile?.full_name || currentUser.email,
      owner_email: currentUser.email,
      title,
      description,
      price,
      category,
      images: imageUrls,
      school,
      program: program || null,
      created_at: new Date().toISOString(),
      view_count: existingListing ? existingListing.view_count : 0,
      rating_sum: existingListing ? existingListing.rating_sum : 0,
      rating_count: existingListing ? existingListing.rating_count : 0,
      is_deleted: false,
    };
    let opError;
    if (isEditing) {
      const { error } = await supabase
        .from('listings')
        .update(listingRecord)
        .eq('id', listingId);
      opError = error;
    } else {
      const { error } = await supabase.from('listings').insert(listingRecord);
      opError = error;
    }
    if (opError) {
      showNotification('Failed to save listing.', 'error');
    } else {
      showNotification('Listing saved successfully!', 'success');
      // Redirect to details page
      window.location.hash = `#/listing/${listingId}`;
    }
  });
}

/**
 * Render the detail view for a single listing.  The page shows all images,
 * description, seller information and provides controls for saving, editing,
 * deleting, reporting and initiating a conversation with the seller.  When
 * accessed, the listing's view count is incremented.
 *
 * @param {string} id The listing ID to display
 */
async function renderListingDetailsPage(id) {
  const content = document.getElementById('content');
  const template = document.getElementById('listing-details-template');
  if (!content || !template) return;
  // Ensure the SPA container is visible and the landing content hidden
  showDynamicContent();
  content.innerHTML = '';
  const wrapper = template.content.cloneNode(true);
  content.appendChild(wrapper);
  const container = content.querySelector('#listing-details-content');
  container.innerHTML = '<p class="text-center">Loading...</p>';
  // Fetch listing
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data || data.is_deleted) {
    container.innerHTML = '<p class="text-red-600">Listing not found or has been removed.</p>';
    return;
  }
  const listing = data;
  // Increment view count
  await supabase
    .from('listings')
    .update({ view_count: listing.view_count + 1 })
    .eq('id', id);
  // Preload saved IDs
  if (currentUser) {
    await loadSavedListingIds();
  }
  // Clear container and build UI
  container.innerHTML = '';
  // Image gallery
  const gallery = document.createElement('div');
  gallery.className = 'w-full flex flex-col md:flex-row gap-4';
  const mainImg = document.createElement('img');
  mainImg.className = 'w-full md:w-2/3 h-64 object-cover rounded';
  const images = Array.isArray(listing.images) && listing.images.length > 0 ? listing.images : ['https://placehold.co/600x400?text=No+Image'];
  mainImg.src = images[0];
  gallery.appendChild(mainImg);
  if (images.length > 1) {
    const thumbs = document.createElement('div');
    thumbs.className = 'flex md:flex-col md:w-1/3 gap-2 overflow-x-auto';
    images.forEach((url) => {
      const thumb = document.createElement('img');
      thumb.src = url;
      thumb.className = 'h-20 w-20 object-cover rounded cursor-pointer';
      thumb.addEventListener('click', () => {
        mainImg.src = url;
      });
      thumbs.appendChild(thumb);
    });
    gallery.appendChild(thumbs);
  }
  container.appendChild(gallery);
  // Title & price
  const titleEl = document.createElement('h2');
  titleEl.className = 'text-3xl font-semibold mt-4';
  titleEl.textContent = listing.title;
  container.appendChild(titleEl);
  const priceEl = document.createElement('p');
  priceEl.className = 'text-2xl text-blue-600 font-bold mt-2';
  priceEl.textContent = listing.price ? `CAD $${Number(listing.price).toFixed(2)}` : 'Free';
  container.appendChild(priceEl);
  // Category, school, program
  const metaEl = document.createElement('p');
  metaEl.className = 'text-gray-600 mt-1';
  metaEl.textContent = `${listing.category} • ${listing.school}${listing.program ? ' • ' + listing.program : ''}`;
  container.appendChild(metaEl);
  // Seller info
  const sellerEl = document.createElement('p');
  sellerEl.className = 'mt-1';
  sellerEl.innerHTML = `<span class="font-semibold">Seller:</span> ${listing.owner_name}`;
  container.appendChild(sellerEl);
  // Description
  const descEl = document.createElement('p');
  descEl.className = 'mt-4 whitespace-pre-line';
  descEl.textContent = listing.description;
  container.appendChild(descEl);
  // Controls (save, contact, edit/delete, report)
  const controls = document.createElement('div');
  controls.className = 'mt-6 flex flex-wrap gap-4 items-center';
  // Save button
  if (currentUser) {
    const saveBtn = document.createElement('button');
    const isSaved = savedListingIds.has(listing.id);
    saveBtn.innerHTML = isSaved ? '❤️ Saved' : '🤍 Save';
    saveBtn.className = 'px-4 py-2 rounded border border-gray-300 hover:bg-gray-100';
    saveBtn.addEventListener('click', async () => {
      if (savedListingIds.has(listing.id)) {
        await supabase
          .from('saved_listings')
          .delete()
          .match({ user_id: currentUser.id, listing_id: listing.id });
        savedListingIds.delete(listing.id);
        saveBtn.innerHTML = '🤍 Save';
      } else {
        await supabase
          .from('saved_listings')
          .insert({ user_id: currentUser.id, listing_id: listing.id });
        savedListingIds.add(listing.id);
        saveBtn.innerHTML = '❤️ Saved';
      }
    });
    controls.appendChild(saveBtn);
    // Contact seller button (if not owner)
    if (listing.owner_id !== currentUser.id) {
      const contactBtn = document.createElement('button');
      contactBtn.textContent = 'Contact Seller';
      contactBtn.className = 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700';
      contactBtn.addEventListener('click', () => {
        // Navigate to messages page with other user id
        const conversationId = getConversationId(currentUser.id, listing.owner_id);
        window.location.hash = `#/messages/${conversationId}`;
      });
      controls.appendChild(contactBtn);
    }
    // Rate listing button (if not owner) – opens a rating modal
    if (listing.owner_id !== currentUser.id) {
      const rateBtn = document.createElement('button');
      rateBtn.textContent = 'Leave a Rating';
      rateBtn.className = 'px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600';
      rateBtn.addEventListener('click', () => {
        showRatingModal(listing);
      });
      controls.appendChild(rateBtn);
    }
    // Edit & delete buttons if owner
    if (listing.owner_id === currentUser.id) {
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.className = 'px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600';
      editBtn.addEventListener('click', () => {
        window.location.hash = `#/new-listing/${listing.id}`;
      });
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to delete this listing?')) return;
        await supabase
          .from('listings')
          .update({ is_deleted: true })
          .eq('id', listing.id);
        showNotification('Listing deleted.', 'success');
        window.location.hash = '#/home';
      });
      controls.appendChild(editBtn);
      controls.appendChild(deleteBtn);
    }
  }
  // Report button (for all viewers)
  const reportBtn = document.createElement('button');
  reportBtn.textContent = 'Report Listing';
  reportBtn.className = 'px-4 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200';
  reportBtn.addEventListener('click', async () => {
    const reason = prompt('Describe why you are reporting this listing:');
    if (!reason) return;
    await supabase.from('reports').insert({
      listing_id: listing.id,
      user_id: currentUser ? currentUser.id : null,
      reason,
    });
    showNotification('Thank you for reporting. Our team will review it.', 'success');
  });
  controls.appendChild(reportBtn);
  container.appendChild(controls);
  // Rating summary
  const ratingSummary = document.createElement('p');
  ratingSummary.className = 'mt-4 text-gray-700';
  const averageRating = listing.rating_count > 0 ? (listing.rating_sum / listing.rating_count).toFixed(1) : null;
  ratingSummary.textContent = averageRating
    ? `Rating: ${averageRating} / 5 from ${listing.rating_count} ratings`
    : 'No ratings yet';
  container.appendChild(ratingSummary);
  // Ratings comments list
  const { data: ratingsData } = await supabase
    .from('ratings')
    .select('*')
    .eq('listing_id', listing.id)
    .order('created_at', { ascending: false });
  if (ratingsData && ratingsData.length) {
    const ratingList = document.createElement('div');
    ratingList.className = 'mt-4 space-y-4';
    ratingsData.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'border border-gray-200 rounded p-2';
      const stars = '★★★★★☆☆☆☆☆'.slice(5 - r.rating, 10 - r.rating);
      const starsEl = document.createElement('div');
      starsEl.textContent = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      starsEl.className = 'text-yellow-500';
      const commentEl = document.createElement('p');
      commentEl.className = 'mt-1';
      commentEl.textContent = r.comment || '';
      item.appendChild(starsEl);
      item.appendChild(commentEl);
      ratingList.appendChild(item);
    });
    container.appendChild(ratingList);
  }
}

/**
 * Show a modal dialog for leaving a rating.  This function creates a simple
 * overlay with star inputs and an optional comment field.  Once the rating
 * is submitted it is stored in the `ratings` table and the listing’s
 * summary statistics are updated.
 *
 * @param {object} listing The listing being rated
 */
function showRatingModal(listing) {
  if (!currentUser) {
    showNotification('Please log in to leave a rating.', 'error');
    return;
  }
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  const modal = document.createElement('div');
  modal.className = 'bg-white rounded p-6 w-96';
  modal.innerHTML = `
    <h3 class="text-xl font-semibold mb-4">Rate this listing</h3>
    <div id="star-container" class="flex space-x-1 mb-4">
      ${[1, 2, 3, 4, 5]
        .map((i) => `<span data-star="${i}" class="cursor-pointer text-2xl text-gray-300">★</span>`) .join('')}
    </div>
    <textarea id="rating-comment" rows="3" placeholder="Optional comment..." class="w-full border border-gray-300 rounded p-2 mb-4"></textarea>
    <div class="flex justify-end space-x-2">
      <button id="cancel-rating" class="px-3 py-1 rounded border">Cancel</button>
      <button id="submit-rating" class="px-3 py-1 bg-yellow-500 text-white rounded">Submit</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Star selection logic
  let selectedRating = 0;
  const starSpans = modal.querySelectorAll('[data-star]');
  starSpans.forEach((star) => {
    star.addEventListener('click', () => {
      selectedRating = parseInt(star.getAttribute('data-star'));
      starSpans.forEach((s, idx) => {
        s.classList.toggle('text-yellow-500', idx < selectedRating);
        s.classList.toggle('text-gray-300', idx >= selectedRating);
      });
    });
  });
  // Cancel
  modal.querySelector('#cancel-rating').addEventListener('click', () => {
    document.body.removeChild(overlay);
  });
  // Submit
  modal.querySelector('#submit-rating').addEventListener('click', async () => {
    if (selectedRating < 1) {
      alert('Please select a rating.');
      return;
    }
    const comment = modal.querySelector('#rating-comment').value.trim();
    // Insert rating
    await supabase.from('ratings').insert({
      listing_id: listing.id,
      user_id: currentUser.id,
      rating: selectedRating,
      comment: comment || null,
    });
    // Update aggregate on listing
    const newSum = listing.rating_sum + selectedRating;
    const newCount = listing.rating_count + 1;
    await supabase
      .from('listings')
      .update({ rating_sum: newSum, rating_count: newCount })
      .eq('id', listing.id);
    showNotification('Thank you for your rating!', 'success');
    document.body.removeChild(overlay);
    // reload page to show updated rating summary
    renderListingDetailsPage(listing.id);
  });
}

/**
 * Compute a deterministic conversation ID given two user IDs.  The smaller
 * UUID is placed first to ensure both participants derive the same value.
 *
 * @param {string} idA First user ID
 * @param {string} idB Second user ID
 * @returns {string} Deterministic conversation ID
 */
function getConversationId(idA, idB) {
  return [idA, idB].sort().join('-');
}

/**
 * Render the messages page.  This page displays a list of conversations on
 * the left and a chat window on the right.  If a conversation ID is
 * provided in the hash then it is opened automatically.
 *
 * @param {string|null} conversationId Optional conversation to open
 */
async function renderMessagesPage(conversationId = null) {
  const content = document.getElementById('content');
  const template = document.getElementById('messages-template');
  if (!content || !template) return;
  // Ensure the SPA container is visible and the landing content hidden
  showDynamicContent();
  content.innerHTML = '';
  const node = template.content.cloneNode(true);
  content.appendChild(node);
  // Elements
  const convList = content.querySelector('#conversation-list');
  const chatMessages = content.querySelector('#chat-messages');
  const chatTitle = content.querySelector('#chat-title');
  const messageForm = content.querySelector('#message-form');
  const messageInput = content.querySelector('#message-input');
  const blockUserBtn = content.querySelector('#block-user-btn');

  // Load conversations
  await loadConversations();
  // If a conversation is specified, open it
  if (conversationId) {
    openConversation(conversationId);
  }

  /**
   * Fetch all conversations for the current user and build the list.  Each
   * conversation list item displays the other participant and a snippet of
   * the last message.  Clicking opens the chat.
   */
  async function loadConversations() {
    convList.innerHTML = '';
    // Get all messages where current user is sender or receiver
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(
        `sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`
      )
      .order('created_at', { ascending: false });
    if (error) {
      showNotification('Unable to load messages.', 'error');
      return;
    }
    // Group messages by conversation
    const convoMap = new Map();
    (data || []).forEach((msg) => {
      const cId = msg.conversation_id;
      if (!convoMap.has(cId)) {
        convoMap.set(cId, []);
      }
      convoMap.get(cId).push(msg);
    });
    // Build list items
    for (const [cId, msgs] of convoMap.entries()) {
      const lastMsg = msgs[0];
      const otherId = lastMsg.sender_id === currentUser.id ? lastMsg.receiver_id : lastMsg.sender_id;
      // Fetch other user info from users table
      const { data: other } = await supabase
        .from('users')
        .select('*')
        .eq('id', otherId)
        .single();
      const li = document.createElement('li');
      li.className = 'p-2 rounded hover:bg-gray-100 cursor-pointer';
      li.innerHTML = `<div class="font-medium">${other?.full_name || other?.email || 'Unknown'}</div>
        <div class="text-sm text-gray-600 truncate">${lastMsg.content}</div>`;
      li.addEventListener('click', () => {
        openConversation(cId);
      });
      convList.appendChild(li);
    }
  }

  /**
   * Open a specific conversation, load its messages and subscribe for
   * real‑time updates.  Updates the chat header to show the other user and
   * provides an input for sending new messages.
   *
   * @param {string} cId The conversation ID to open
   */
  async function openConversation(cId) {
    // Clear any existing subscription
    if (currentChatSubscription) {
      await currentChatSubscription.unsubscribe();
      currentChatSubscription = null;
    }
    // Determine the other user
    const ids = cId.split('-');
    const otherId = ids[0] === currentUser.id ? ids[1] : ids[0];
    // Fetch other user profile
    const { data: other } = await supabase
      .from('users')
      .select('*')
      .eq('id', otherId)
      .single();
    chatTitle.textContent = other?.full_name || other?.email || 'Conversation';
    blockUserBtn.classList.add('hidden');
    if (other && other.blocked) {
      chatTitle.textContent += ' (Blocked)';
    }
    // Load messages
    chatMessages.innerHTML = '<p class="text-center text-gray-500 mt-4">Loading...</p>';
    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', cId)
      .order('created_at', { ascending: true });
    chatMessages.innerHTML = '';
    (msgs || []).forEach((msg) => addMessageToChat(msg, otherId));
    // Subscribe to new messages for this conversation using Postgres changes
    currentChatSubscription = supabase
      .channel('chat-' + cId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${cId}`,
        },
        (payload) => {
          const msg = payload.new;
          addMessageToChat(msg, otherId);
        }
      )
      .subscribe();
    // Handle sending new message
    messageForm.onsubmit = async (e) => {
      e.preventDefault();
      const contentVal = messageInput.value.trim();
      if (!contentVal) return;
      await supabase.from('messages').insert({
        conversation_id: cId,
        sender_id: currentUser.id,
        receiver_id: otherId,
        content: contentVal,
      });
      messageInput.value = '';
    };
  }

  /**
   * Append a message to the chat area.  Messages sent by the current user
   * align to the right and those from the other user align to the left.
   *
   * @param {object} msg      The message record
   * @param {string} otherId  The ID of the other user
   */
  function addMessageToChat(msg, otherId) {
    const div = document.createElement('div');
    div.className = 'flex mb-2';
    const isMine = msg.sender_id === currentUser.id;
    div.classList.add(isMine ? 'justify-end' : 'justify-start');
    const bubble = document.createElement('div');
    bubble.className = isMine
      ? 'bg-blue-600 text-white rounded-lg px-3 py-2 max-w-xs'
      : 'bg-gray-200 text-gray-800 rounded-lg px-3 py-2 max-w-xs';
    bubble.textContent = msg.content;
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

/**
 * Render the saved listings page.  Displays the current user's saved items
 * using the same card layout as the home page.  Clicking a card navigates
 * to the listing detail view.  Users can unsave listings directly from
 * this page.
 */
async function renderSavedPage() {
  const content = document.getElementById('content');
  const template = document.getElementById('saved-template');
  if (!content || !template) return;
  // Ensure the SPA container is visible and the landing content hidden
  showDynamicContent();
  content.innerHTML = '';
  const node = template.content.cloneNode(true);
  content.appendChild(node);
  const grid = content.querySelector('#saved-listings');
  await loadSavedListingIds();
  if (savedListingIds.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-center text-gray-500 mt-8';
    empty.textContent = 'You have no saved listings.';
    grid.appendChild(empty);
    return;
  }
  // Fetch listing details for saved IDs
  const idsArray = Array.from(savedListingIds);
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .in('id', idsArray)
    .eq('is_deleted', false);
  if (error) {
    showNotification('Unable to load saved listings.', 'error');
    return;
  }
  // Render cards (reuse logic from home page)
  data.forEach((listing) => {
    const card = document.createElement('div');
    card.className = 'bg-white rounded shadow hover:shadow-lg transition cursor-pointer flex flex-col';
    const img = document.createElement('img');
    img.className = 'h-40 w-full object-cover rounded-t';
    const firstImage = Array.isArray(listing.images) && listing.images.length > 0 ? listing.images[0] : null;
    img.src = firstImage || 'https://placehold.co/400x300?text=No+Image';
    card.appendChild(img);
    const info = document.createElement('div');
    info.className = 'p-4 flex-1 flex flex-col';
    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold mb-1 truncate';
    title.textContent = listing.title;
    info.appendChild(title);
    const price = document.createElement('p');
    price.className = 'text-blue-600 font-bold mb-1';
    price.textContent = listing.price ? `CAD $${Number(listing.price).toFixed(2)}` : 'Free';
    info.appendChild(price);
    const schoolLine = document.createElement('p');
    schoolLine.className = 'text-sm text-gray-600';
    schoolLine.textContent = listing.school;
    info.appendChild(schoolLine);
    const programLine = document.createElement('p');
    programLine.className = 'text-sm text-gray-600 mb-2';
    programLine.textContent = listing.program || '';
    info.appendChild(programLine);
    // Unsave button
    const unsaveBtn = document.createElement('button');
    unsaveBtn.innerHTML = '❤️ Remove';
    unsaveBtn.className = 'self-start text-2xl focus:outline-none';
    unsaveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await supabase
        .from('saved_listings')
        .delete()
        .match({ user_id: currentUser.id, listing_id: listing.id });
      savedListingIds.delete(listing.id);
      renderSavedPage();
    });
    info.appendChild(unsaveBtn);
    card.appendChild(info);
    card.addEventListener('click', () => {
      window.location.hash = `#/listing/${listing.id}`;
    });
    grid.appendChild(card);
  });
}

/**
 * Render the user's profile page or another user's public profile.  The
 * current user can edit their own profile details.  A list of the user's
 * listings is shown below their basic information.  If viewing another
 * user, a button to initiate a conversation is available.
 *
 * @param {string|null} id Optional ID of the profile to view
 */
async function renderProfilePage(id = null) {
  const content = document.getElementById('content');
  const template = document.getElementById('profile-template');
  if (!content || !template) return;
  // Ensure the SPA container is visible and the landing content hidden
  showDynamicContent();
  content.innerHTML = '';
  const node = template.content.cloneNode(true);
  content.appendChild(node);
  const container = content.querySelector('#profile-content');
  container.innerHTML = '<p class="text-center">Loading...</p>';
  const profileId = id || currentUser?.id;
  if (!profileId) {
    showNotification('User not found.', 'error');
    container.innerHTML = '';
    return;
  }
  // Fetch profile from users table
  const { data: profileData, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', profileId)
    .single();
  if (error || !profileData) {
    container.innerHTML = '<p class="text-red-600">Unable to load profile.</p>';
    return;
  }
  const isOwnProfile = currentUser && profileId === currentUser.id;
  container.innerHTML = '';
  // Display basic info
  const nameEl = document.createElement('h2');
  nameEl.className = 'text-2xl font-semibold';
  nameEl.textContent = profileData.full_name || profileData.email;
  container.appendChild(nameEl);
  const schoolEl = document.createElement('p');
  schoolEl.className = 'text-gray-700';
  schoolEl.textContent = profileData.school_name;
  container.appendChild(schoolEl);
  if (profileData.program_name) {
    const programEl = document.createElement('p');
    programEl.className = 'text-gray-700';
    programEl.textContent = profileData.program_name;
    container.appendChild(programEl);
  }
  // Rating summary
  const ratingText = document.createElement('p');
  ratingText.className = 'mt-2 text-gray-700';
  const avg = profileData.rating_count > 0 ? (profileData.rating_sum / profileData.rating_count).toFixed(1) : null;
  ratingText.textContent = avg
    ? `Seller rating: ${avg} / 5 (${profileData.rating_count} reviews)`
    : 'No ratings yet';
  container.appendChild(ratingText);
  // If viewing another user, show message button
  if (!isOwnProfile && currentUser) {
    const msgBtn = document.createElement('button');
    msgBtn.textContent = 'Message';
    msgBtn.className = 'mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700';
    msgBtn.addEventListener('click', () => {
      const convoId = getConversationId(currentUser.id, profileId);
      window.location.hash = `#/messages/${convoId}`;
    });
    container.appendChild(msgBtn);
  }
  // Edit form for own profile
  if (isOwnProfile) {
    const editForm = document.createElement('form');
    editForm.className = 'mt-4 space-y-3';
    editForm.innerHTML = `
      <h3 class="text-xl font-semibold">Edit Profile</h3>
      <div>
        <label class="block text-sm font-medium text-gray-700">Full Name</label>
        <input type="text" id="edit-fullname" class="mt-1 block w-full rounded border-gray-300 p-2" value="${profileData.full_name || ''}" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">School</label>
        <input type="text" id="edit-school" class="mt-1 block w-full rounded border-gray-300 p-2" value="${profileData.school_name || ''}" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700">Program (optional)</label>
        <input type="text" id="edit-program" class="mt-1 block w-full rounded border-gray-300 p-2" value="${profileData.program_name || ''}" />
      </div>
      <button type="submit" class="px-4 py-2 bg-green-600 text-white rounded">Save Changes</button>
    `;
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = editForm.querySelector('#edit-fullname').value.trim();
      const school = editForm.querySelector('#edit-school').value.trim();
      const program = editForm.querySelector('#edit-program').value.trim();
      const { error: updateError } = await supabase
        .from('users')
        .update({
          full_name: fullName,
          school_name: school,
          program_name: program || null,
        })
        .eq('id', currentUser.id);
      if (updateError) {
        showNotification('Failed to update profile.', 'error');
      } else {
        showNotification('Profile updated successfully!', 'success');
        // Refresh local state and re-render page
        const { data: updated } = await supabase
          .from('users')
          .select('*')
          .eq('id', currentUser.id)
          .single();
        userProfile = updated;
        renderProfilePage();
      }
    });
    container.appendChild(editForm);
  }
  // List of user's listings
  const { data: userListings } = await supabase
    .from('listings')
    .select('*')
    .eq('owner_id', profileId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (userListings && userListings.length > 0) {
    const listHeader = document.createElement('h3');
    listHeader.className = 'mt-6 text-xl font-semibold';
    listHeader.textContent = isOwnProfile ? 'My Listings' : 'Listings';
    container.appendChild(listHeader);
    const grid = document.createElement('div');
    grid.className = 'grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
    userListings.forEach((listing) => {
      const card = document.createElement('div');
      card.className = 'bg-white rounded shadow hover:shadow-lg transition cursor-pointer flex flex-col';
      const img = document.createElement('img');
      img.className = 'h-40 w-full object-cover rounded-t';
      const firstImage = Array.isArray(listing.images) && listing.images.length > 0 ? listing.images[0] : null;
      img.src = firstImage || 'https://placehold.co/400x300?text=No+Image';
      card.appendChild(img);
      const info = document.createElement('div');
      info.className = 'p-4 flex-1 flex flex-col';
      const title = document.createElement('h3');
      title.className = 'text-lg font-semibold mb-1 truncate';
      title.textContent = listing.title;
      info.appendChild(title);
      const price = document.createElement('p');
      price.className = 'text-blue-600 font-bold mb-1';
      price.textContent = listing.price ? `CAD $${Number(listing.price).toFixed(2)}` : 'Free';
      info.appendChild(price);
      info.appendChild(document.createElement('div'));
      card.appendChild(info);
      card.addEventListener('click', () => {
        window.location.hash = `#/listing/${listing.id}`;
      });
      grid.appendChild(card);
    });
    container.appendChild(grid);
  } else {
    const noList = document.createElement('p');
    noList.className = 'mt-6 text-gray-500';
    noList.textContent = isOwnProfile ? 'You have no active listings.' : 'No listings.';
    container.appendChild(noList);
  }
}

/**
 * Render the admin panel.  This page is only accessible to users with the
 * is_admin flag set.  It displays flagged listings reported by users and
 * blocked users.  Admins can delete listings or unblock users directly
 * from this interface.
 */
async function renderAdminPage() {
  const content = document.getElementById('content');
  const template = document.getElementById('admin-template');
  if (!content || !template) return;
  // Ensure the SPA container is visible and the landing content hidden
  showDynamicContent();
  content.innerHTML = '';
  const node = template.content.cloneNode(true);
  content.appendChild(node);
  const flaggedContainer = content.querySelector('#flagged-listings');
  const blockedContainer = content.querySelector('#blocked-users');
  flaggedContainer.innerHTML = '<p>Loading flagged listings...</p>';
  blockedContainer.innerHTML = '<p>Loading blocked users...</p>';
  // Fetch flagged listings grouped by listing_id
  const { data: reports } = await supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false });
  flaggedContainer.innerHTML = '';
  if (reports && reports.length) {
    // Group by listing
    const grouped = {};
    reports.forEach((r) => {
      if (!grouped[r.listing_id]) grouped[r.listing_id] = [];
      grouped[r.listing_id].push(r);
    });
    for (const listingId of Object.keys(grouped)) {
      // Fetch listing details
      const { data: listing } = await supabase
        .from('listings')
        .select('*')
        .eq('id', listingId)
        .single();
      if (!listing) continue;
      const reportsForListing = grouped[listingId];
      const div = document.createElement('div');
      div.className = 'border border-gray-200 rounded p-4';
      div.innerHTML = `
        <h4 class="font-semibold text-lg mb-2">${listing.title}</h4>
        <p class="text-gray-700 mb-2">${listing.description.slice(0, 100)}...</p>
        <p class="text-sm text-gray-600 mb-2">${reportsForListing.length} report(s)</p>
      `;
      const actions = document.createElement('div');
      actions.className = 'flex gap-2';
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Delete Listing';
      removeBtn.className = 'px-3 py-1 bg-red-500 text-white rounded';
      removeBtn.addEventListener('click', async () => {
        if (!confirm('Delete this listing?')) return;
        await supabase
          .from('listings')
          .update({ is_deleted: true })
          .eq('id', listingId);
        showNotification('Listing removed.', 'success');
        renderAdminPage();
      });
      const ignoreBtn = document.createElement('button');
      ignoreBtn.textContent = 'Ignore';
      ignoreBtn.className = 'px-3 py-1 bg-gray-200 rounded';
      ignoreBtn.addEventListener('click', async () => {
        // Delete reports for this listing
        await supabase
          .from('reports')
          .delete()
          .eq('listing_id', listingId);
        showNotification('Reports cleared.', 'success');
        renderAdminPage();
      });
      actions.appendChild(removeBtn);
      actions.appendChild(ignoreBtn);
      div.appendChild(actions);
      flaggedContainer.appendChild(div);
    }
  } else {
    flaggedContainer.innerHTML = '<p>No flagged listings.</p>';
  }
  // Load blocked users
  const { data: blockedUsers } = await supabase
    .from('users')
    .select('*')
    .eq('blocked', true);
  blockedContainer.innerHTML = '';
  if (blockedUsers && blockedUsers.length) {
    blockedUsers.forEach((usr) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between items-center border-b py-2';
      row.innerHTML = `<span>${usr.full_name || usr.email}</span>`;
      const unblockBtn = document.createElement('button');
      unblockBtn.textContent = 'Unblock';
      unblockBtn.className = 'px-3 py-1 bg-green-500 text-white rounded';
      unblockBtn.addEventListener('click', async () => {
        await supabase
          .from('users')
          .update({ blocked: false })
          .eq('id', usr.id);
        showNotification('User unblocked.', 'success');
        renderAdminPage();
      });
      row.appendChild(unblockBtn);
      blockedContainer.appendChild(row);
    });
  } else {
    blockedContainer.innerHTML = '<p>No blocked users.</p>';
  }
}

/**
 * Initialise the application.  Sets the year in the footer, fetches the
 * current session and user profile, sets up the navigation and routing and
 * subscribes to auth state changes to keep the UI in sync.
 */
async function init() {
  // Set current year in footer
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
  // Retrieve the current session and user profile
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user || null;
  if (currentUser) {
    // Load profile from users table
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', currentUser.id)
      .single();
    userProfile = profile;
  }
  // Render nav and route
  renderNav();
  handleRoute();
  // Listen for hash changes
  window.addEventListener('hashchange', handleRoute);
  // Listen for auth changes
  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', currentUser.id)
        .single();
      userProfile = profile;
    } else {
      userProfile = null;
    }
    renderNav();
    handleRoute();
  });
}

// Kick off the app
init();