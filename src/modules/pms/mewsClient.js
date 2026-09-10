/**
 * Official Mews Connector API Client wrapper
 */
export class MewsClient {
  constructor() {
    this.clientToken = (process.env.MEWS_CLIENT_TOKEN || '').trim();
    this.systemAccessToken = (process.env.MEWS_ACCESS_TOKEN || '').trim();
    // Base URL pointed to Mews Demo API
    this.baseUrl = (process.env.MEWS_API_URL || 'https://api.mews-demo.com').replace(/\/api\/connector\/v1\/?$/, '').replace(/\/+$/, '');
    this.cachedStayServiceId = (process.env.MEWS_STAY_SERVICE_ID || '').trim() || null;
  }

  /**
   * Helper method to send authenticated POST requests to Mews API
   * Implements Client identification, rate limiting (HTTP 429) backoff (5s, 10s, 15s) and retries.
   */
  async _post(path, accessToken, payload = {}) {
    const clientToken = (this.clientToken || '').trim();
    if (!clientToken) {
      throw new Error('MEWS_CLIENT_TOKEN environment variable is not configured');
    }

    const token = (accessToken !== undefined && accessToken !== null && String(accessToken).trim() !== '')
      ? String(accessToken).trim()
      : this.systemAccessToken;
    if (!token || token.trim().length < 4) {
      throw new Error('Valid Mews Access Token or property credential is required');
    }

    const cleanPath = path.startsWith('/api/connector/v1')
      ? path
      : `/api/connector/v1${path.startsWith('/') ? path : `/${path}`}`;
    const endpoint = `${this.baseUrl}${cleanPath}`;
    const httpFetch = globalThis.fetch || fetch;

    const requestBody = {
      ClientToken: clientToken,
      AccessToken: token.trim(),
      Client: 'HotelPlatform 1.0.0',
      ...payload,
    };

    const maxAttempts = 2;
    const backoffs = [1200, 2400]; // 1.2s, 2.4s backoff intervals for HTTP 429 rate limit recovery
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await httpFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined,
        });

        // Handle HTTP 429 Rate Limiting with Retry-After header and exponential backoff
        if (response.status === 429) {
          const retryAfterHeader = response.headers?.get ? response.headers.get('Retry-After') : null;
          let delay = backoffs[attempt - 1] || 15000;
          if (retryAfterHeader) {
            const parsed = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsed) && parsed > 0) {
              delay = Math.max(delay, (parsed + 1) * 1000);
            }
          }
          console.warn(`[MewsClient] HTTP 429 Rate limited on ${cleanPath}. Retrying attempt ${attempt}/${maxAttempts} in ${delay}ms...`);
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }

        if (!response.ok) {
          let errorMessage = `Mews API returned HTTP ${response.status}`;
          try {
            const errData = await response.json();
            if (errData && (errData.Message || errData.message)) {
              errorMessage = `Mews API Error: ${errData.Message || errData.message}`;
            }
          } catch {
            // ignore json parse error
          }
          throw new Error(errorMessage);
        }

        return await response.json();
      } catch (err) {
        lastError = err;
        const msg = String(err.message || '');
        // Do not retry fatal client errors
        if (
          attempt < maxAttempts &&
          !msg.includes('HTTP 400') &&
          !msg.includes('HTTP 401') &&
          !msg.includes('HTTP 403') &&
          !msg.includes('HTTP 404')
        ) {
          const delay = backoffs[attempt - 1] || 5000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        break;
      }
    }

    throw lastError;
  }

  /**
   * Validates Mews Connector API credentials with Mews API.
   * Dynamically extracts Enterprise Name, Property ID, and confirms connectivity.
   */
  async validateEnterpriseAccess(tokenOrPropertyId) {
    const cleanToken = (tokenOrPropertyId && String(tokenOrPropertyId).trim()) || '';
    if (!cleanToken || cleanToken.length < 4) {
      throw new Error('Valid Mews Access Token is required');
    }

    let enterpriseId = '';
    let enterpriseName = '';
    let raw = null;

    // 1. Try to fetch enterprise configuration from Mews Connector API
    try {
      const configData = await this._post('/configuration/get', cleanToken, {});
      if (configData?.Enterprise) {
        enterpriseId = configData.Enterprise.Id || '';
        enterpriseName = configData.Enterprise.Name || configData.Enterprise.LegalName || '';
        raw = configData;
      }
    } catch (configErr) {
      // If /configuration/get is restricted or unavailable, validate via /customers/getAll
      const custData = await this._post('/customers/getAll', cleanToken, {
        Limitation: { Count: 1 },
        FirstNames: ['a', 'e', 'i', 'o', 'u'],
      });
      raw = custData;
    }

    if (!enterpriseId) {
      enterpriseId = cleanToken.length >= 8 ? cleanToken.slice(0, 8) : cleanToken;
    }
    if (!enterpriseName) {
      enterpriseName = 'Mews Connected Property';
    }

    return {
      success: true,
      status: 'connected',
      pmsType: 'mews',
      propertyId: enterpriseId,
      enterpriseId,
      enterpriseName,
      accessTokenUsed: cleanToken,
      raw,
    };
  }

  /**
   * Fetch Services from Mews Connector API
   * Endpoint: POST /api/connector/v1/services/getAll
   */
  async getServices(accessToken) {
    try {
      const data = await this._post('/services/getAll', accessToken, {
        Limitation: { Count: 50 },
      });
      return data.Services || [];
    } catch (err) {
      console.warn('[MewsClient] getServices error:', err.message);
      return [];
    }
  }

  /**
   * Dynamically discover Stay Service ID from Mews services list and cache it
   */
  async getStayServiceId(accessToken) {
    if (this.cachedStayServiceId) {
      return this.cachedStayServiceId;
    }
    try {
      const services = await this.getServices(accessToken);
      const stayService = services.find(
        (s) => s.Type === 'Stay' || s.Name?.toLowerCase().includes('stay')
      );
      if (stayService?.Id) {
        this.cachedStayServiceId = stayService.Id;
        return stayService.Id;
      }
    } catch (err) {
      console.warn('[MewsClient] getStayServiceId error:', err.message);
    }
    return process.env.MEWS_STAY_SERVICE_ID || null;
  }

  /**
   * Fetch Resources/Rooms from Mews Connector API
   * Endpoint: POST /api/connector/v1/resources/getAll
   * Extent: { Resources: true, ResourceCategories: true } and limitation count 100
   */
  async getResources(accessToken, options = {}) {
    const data = await this._post('/resources/getAll', accessToken, {
      Limitation: { Count: options.limit || 100 },
      Extent: { Resources: true, ResourceCategories: true, ...(options.extent || {}) },
      ...options,
    });
    return data.Resources || [];
  }

  /**
   * Fetch Customers/Guests from Mews Connector API
   * Endpoint: POST /api/connector/v1/customers/getAll
   * With FirstNames filter ["a", "e", "i", "o", "u"] and fallback to safe UTC range, limitation count 50
   */
  async getCustomers(accessToken, options = {}) {
    const limit = options.limit || 50;

    // 1. Primary: FirstNames filter
    try {
      const data = await this._post('/customers/getAll', accessToken, {
        FirstNames: ['a', 'e', 'i', 'o', 'u'],
        Limitation: { Count: limit },
        Extent: { Customers: true, Addresses: true },
      });
      if (data.Customers && data.Customers.length > 0) {
        return data.Customers;
      }
    } catch (err) {
      console.warn('[MewsClient] getCustomers FirstNames query fallback:', err.message);
    }

    // 2. Safe UTC range fallback
    const now = new Date();
    const daysBack = options.daysBack || 90;
    const startUtc = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const endUtc = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const data = await this._post('/customers/getAll', accessToken, {
      TimeFilter: 'Created',
      StartUtc: startUtc,
      EndUtc: endUtc,
      Limitation: { Count: limit },
      Extent: { Customers: true, Addresses: true },
    });
    return data.Customers || [];
  }

  /**
   * Fetch Reservations from Mews Connector API
   * Endpoint: POST /api/connector/v1/reservations/getAll
   * Formatted strictly as ISO-8601 UTC strings.
   * Root-level StartUtc/EndUtc within a 72-hour window to satisfy Mews's < 100h interval limit.
   */
  async getReservations(accessToken, options = {}) {
    const now = new Date();
    // Strictly 72-hour window (24h back to 48h ahead) to satisfy Mews < 100h interval limit
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
    const end = new Date(start.getTime() + 72 * 60 * 60 * 1000); // 72 hours total window

    const startUtc = start.toISOString();
    const endUtc = end.toISOString();
    const limit = options.limit || 50;

    // 1. Primary: Mews Connector API v1 valid root-level schema for colliding reservations
    try {
      const data = await this._post('/reservations/getAll', accessToken, {
        TimeFilter: 'Colliding',
        StartUtc: startUtc,
        EndUtc: endUtc,
        Limitation: { Count: limit },
        Extent: { Reservations: true, Customers: true },
      });
      if (data && data.Reservations && data.Reservations.length > 0) {
        return data.Reservations;
      }
    } catch (collidingErr) {
      console.warn('[MewsClient] Colliding reservations query attempt:', collidingErr.message);
      // Try nested CollidingUtc format if API version prefers nested
      try {
        const data = await this._post('/reservations/getAll', accessToken, {
          CollidingUtc: { StartUtc: startUtc, EndUtc: endUtc },
          Limitation: { Count: limit },
          Extent: { Reservations: true, Customers: true },
        });
        if (data && data.Reservations && data.Reservations.length > 0) {
          return data.Reservations;
        }
      } catch (nestedErr) {
        console.warn('[MewsClient] Nested CollidingUtc query attempt:', nestedErr.message);
      }
    }

    // 2. Secondary: Fallback to recent reservations via TimeFilter: "Created" (past 30 days)
    try {
      const createdStartUtc = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const createdEndUtc = now.toISOString();
      const data = await this._post('/reservations/getAll', accessToken, {
        TimeFilter: 'Created',
        StartUtc: createdStartUtc,
        EndUtc: createdEndUtc,
        Limitation: { Count: limit },
        Extent: { Reservations: true, Customers: true },
      });
      return data.Reservations || [];
    } catch (createdErr) {
      console.warn('[MewsClient] Created filter reservations query attempt:', createdErr.message);
      return [];
    }
  }

  /**
   * Fetch Availability from Mews Connector API
   * Endpoint: POST /api/connector/v1/services/getAvailability
   */
  async getAvailability(accessToken, { startUtc, endUtc, serviceId } = {}) {
    try {
      let effectiveServiceId = serviceId;
      if (!effectiveServiceId) {
        effectiveServiceId = await this.getStayServiceId(accessToken);
      }
      const data = await this._post('/services/getAvailability', accessToken, {
        StartUtc: startUtc || new Date().toISOString(),
        EndUtc: endUtc || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        ...(effectiveServiceId ? { ServiceId: effectiveServiceId } : {}),
      });
      return data.ResourceCategoryAvailabilities || [];
    } catch (err) {
      console.warn('[MewsClient] getAvailability warning:', err.message);
      return [];
    }
  }

  /**
   * Fetch Rates & Pricing from Mews Connector API
   * Endpoint: POST /api/connector/v1/rates/getAll
   */
  async getRates(accessToken, options = {}) {
    try {
      const data = await this._post('/rates/getAll', accessToken, {
        Limitation: { Count: options.limit || 50 },
        Extent: { Rates: true, RateGroups: true, ...(options.extent || {}) },
        ...options,
      });
      return data.Rates || [];
    } catch (err) {
      console.warn('[MewsClient] getRates warning:', err.message);
      return [];
    }
  }

  /**
   * Update Room/Space Status in Mews Connector API
   * Endpoint: POST /api/connector/v1/spaces/update
   */
  async updateSpaceStatus(accessToken, { spaceId, status }) {
    if (!spaceId) return { success: false, reason: 'Missing spaceId' };
    try {
      const data = await this._post('/spaces/update', accessToken, {
        SpaceId: spaceId,
        State: status, // e.g. 'Clean', 'Dirty', 'Inspected'
      });
      return { success: true, data };
    } catch (err) {
      console.warn('[MewsClient] updateSpaceStatus warning:', err.message);
      return { success: false, error: err.message };
    }
  }
}
