const os = require("os");
const fs = require("fs");
const path = require("path");

class LMSIntegration {
  constructor() {
    this.config = {
      apiUrl: process.env.LMS_API_URL || "http://lms-dev.service.aide-0091473.ap.ctc.development.mesh.uhg.com/api/lms-ssoLogin",
      appName: "N8N",
    };
    this.tokenCacheFile = path.join(os.homedir(), '.n8n-desktop', 'jwt-cache.json');
    this.cachedToken = null;
  }

  ensureCacheDirectory() {
    const cacheDir = path.dirname(this.tokenCacheFile);
    console.log('Ensuring cache directory exists:', cacheDir);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      console.log('Created cache directory:', cacheDir);
    }
  }

  /**
   * Save JWT token to local cache
   * @param {object} tokenData - Token data with JWT and metadata
   */
  saveTokenToCache(tokenData) {
    console.log('');
    console.log('Saving JWT token to cache:', this.tokenCacheFile);
    console.log('Token data:', tokenData);

    try {
      this.ensureCacheDirectory();

      const cacheData = {
        jwt: tokenData.jwt,
        isNIEUser: tokenData.isNIEUser,
        isLDAPEnabled: tokenData.isLDAPEnabled,
        hasGroupAccess: tokenData.hasGroupAccess,
        key: tokenData.key,
        cachedAt: Date.now(),
        expiresAt: this.getTokenExpiration(tokenData.jwt)
      };

      fs.writeFileSync(this.tokenCacheFile, JSON.stringify(cacheData, null, 2));
      console.log('JWT token saved to cache');

      this.cachedToken = cacheData;
      return true;

    } catch (error) {
      console.error('Error saving token to cache:', error);
      return false;
    }
  }

  /**
   * Load JWT token from local cache
   * @returns {object|null} Cached token data or null
   */
  loadTokenFromCache() {
    try {
      if (fs.existsSync(this.tokenCacheFile)) {
        const cacheData = JSON.parse(fs.readFileSync(this.tokenCacheFile, 'utf8'));
        this.cachedToken = cacheData;
        console.log('JWT token loaded from cache');
        return cacheData;
      }

      console.log('No cached token found');
      return null;

    } catch (error) {
      console.error('Error loading token from cache:', error);
      this.clearTokenCache(); // Clear corrupted cache
      return null;
    }
  }

  /**
   * Clear token cache
   */
  clearTokenCache() {
    try {
      if (fs.existsSync(this.tokenCacheFile)) {
        fs.unlinkSync(this.tokenCacheFile);
        console.log('Token cache cleared');
      }
      this.cachedToken = null;
    } catch (error) {
      console.error('Error clearing token cache:', error);
    }
  }

  /**
   * Get token expiration timestamp
   * @param {string} jwt - JWT token
   * @returns {number|null} Expiration timestamp or null
   */
  getTokenExpiration(jwt) {
    try {
      const decoded = this.decodeJWT(jwt);
      if (decoded && decoded.payload.exp) {
        return decoded.payload.exp * 1000; // Convert to milliseconds
      }
      return null;
    } catch (error) {
      console.error('Error getting token expiration:', error);
      return null;
    }
  }

  /**
   * Check if cached token is valid
   * @param {object} cachedToken - Cached token data
   * @returns {boolean} True if token is valid
   */
  isCachedTokenValid(cachedToken) {
    if (!cachedToken || !cachedToken.jwt) {
      console.log('No cached token available');
      return false;
    }

    // Check if token is expired
    if (cachedToken.expiresAt && Date.now() >= cachedToken.expiresAt) {
      console.log('Cached token is expired');
      return false;
    }

    // Additional buffer time (5 minutes before actual expiration)
    const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
    if (cachedToken.expiresAt && Date.now() >= (cachedToken.expiresAt - bufferTime)) {
      console.log('Cached token expires soon, will refresh');
      return false;
    }

    // Check if token structure is valid
    const decoded = this.decodeJWT(cachedToken.jwt);
    if (!decoded) {
      console.log('Cached token is invalid');
      return false;
    }

    console.log('Cached token is valid');
    return true;
  }

  /**
   * Get valid JWT token (from cache or API)
   * @param {string} bearerToken - Bearer token for API
   * @returns {Promise<object|null>} Valid token data or null
   */
  async getValidToken(bearerToken) {
    // First, try to load from cache
    const cachedToken = this.loadTokenFromCache();

    if (this.isCachedTokenValid(cachedToken)) {
      console.log('Using cached JWT token');
      this.jwtToken = cachedToken.jwt;
      this.lastResponse = cachedToken;
      return cachedToken;
    }

    // If no valid cached token, make API request
    console.log('Cached token invalid or expired, fetching new token...');
    const tokenData = await this.performSSOLogin(bearerToken);

    if (tokenData) {
      // Save new token to cache
      this.saveTokenToCache(tokenData);
      return tokenData;
    }

    return null;
  }

  /**
   * Initialize LMS integration with token caching
   * @param {string} bearerToken - Authorization token
   * @param {boolean} exitOnFailure - Whether to exit process on failure
   * @returns {Promise<boolean>} Success status
   */
  async initialize(bearerToken, exitOnFailure = true) {
    if (!bearerToken) {
      console.error("Bearer token is required for LMS integration");

      if (exitOnFailure) {
        console.error("No bearer token provided. Exiting application...");
        this.exitProcess(1);
      }

      return false;
    }

    console.log("Initializing LMS integration...");

    try {
      // Get valid token (cached or fresh)
      const tokenData = await this.getValidToken(bearerToken);

      if (tokenData) {
        this.lastResponse = tokenData;
        console.log("LMS Integration initialized successfully");
        console.log("User Status:");
        console.log("- NIE User:", tokenData.isNIEUser);
        console.log("- LDAP Enabled:", tokenData.isLDAPEnabled);
        console.log("- Group Access:", tokenData.hasGroupAccess);

        const expirationDate = tokenData.expiresAt ? new Date(tokenData.expiresAt) : 'Unknown';
        console.log("- Token expires at:", expirationDate);

        // Check if user has required access
        if (!(tokenData.hasGroupAccess || tokenData.isNIEUser || tokenData.isLDAPEnabled)) {
          console.warn("Warning: User does not have required access");

          if (exitOnFailure) {
            console.error("Insufficient permissions. Exiting application...");
            this.exitProcess(2);
          }
        }

        return true;
      } else {
        console.error("Failed to get valid JWT token");

        if (exitOnFailure) {
          console.error("LMS authentication failed. Exiting application...");
          this.exitProcess(3);
        }

        return false;
      }

    } catch (error) {
      console.error("Error during LMS initialization:", error);

      if (exitOnFailure) {
        console.error("LMS initialization error. Exiting application...");
        this.exitProcess(4);
      }

      return false;
    }
  }

  /**
   * Get current JWT token info with cache status
   * @returns {object} Token information
   */
  getTokenStatus() {
    console.log(this.tokenCacheFile);
    const cachedToken = this.cachedToken || this.loadTokenFromCache();


    if (!cachedToken) {
      return {
        hasToken: false,
        isValid: false,
        source: 'none'
      };
    }

    const isValid = this.isCachedTokenValid(cachedToken);
    const expirationDate = cachedToken.expiresAt ? new Date(cachedToken.expiresAt) : null;
    const timeUntilExpiry = cachedToken.expiresAt ? cachedToken.expiresAt - Date.now() : null;

    return {
      hasToken: true,
      isValid: isValid,
      source: 'cache',
      expirationDate: expirationDate,
      timeUntilExpiry: timeUntilExpiry,
      username: this.getJWTInfo(cachedToken.jwt)?.username,
      hasGroupAccess: cachedToken.hasGroupAccess
    };
  }

  /**
   * Force refresh token (clear cache and get new token)
   * @param {string} bearerToken - Bearer token for API
   * @returns {Promise<object|null>} New token data
   */
  async refreshToken(bearerToken) {
    console.log('Forcing token refresh...');
    this.clearTokenCache();
    return await this.getValidToken(bearerToken);
  }

  /**
   * Get current user email from system
   * @returns {string} User email
   */
  getUserEmail() {
    try {
      const username = os.userInfo().username;
      return username;
    } catch (error) {
      console.error("Error getting user email:", error);
      return null;
    }
  }

  /**
   * Get machine ID/hostname
   * @returns {string} Machine identifier
   */
  getMachineId() {
    try {
      const machineId = os.hostname().replace(".uhc.com.", "");
      return machineId;
    } catch (error) {
      console.error("Error getting machine ID:", error);
      return "UNKNOWN";
    }
  }

  /**
   * Get operating system dynamically
   * @returns {string} Operating system name
   */
  getOperatingSystem() {
    try {
      const platform = os.platform();
      const osMap = {
        darwin: "Mac",
        win32: "Windows",
        linux: "Linux",
        freebsd: "FreeBSD",
        openbsd: "OpenBSD",
        sunos: "SunOS",
        aix: "AIX",
      };

      const osName = osMap[platform] || platform;
      console.log("Detected operating system:", osName);
      return osName;
    } catch (error) {
      console.error("Error getting operating system:", error);
      return "Unknown";
    }
  }

  /**
   * Get local IP address
   * @returns {string} IP address
   */
  getIPAddress() {
    try {
      const networkInterfaces = os.networkInterfaces();

      for (const interfaceName in networkInterfaces) {
        const networkInterface = networkInterfaces[interfaceName];

        for (const network of networkInterface) {
          if (!network.internal && network.family === "IPv4") {
            return network.address;
          }
        }
      }

      return "127.0.0.1";
    } catch (error) {
      console.error("Error getting IP address:", error);
      return "126.0.0.0";
    }
  }

  /**
   * Get public IP address
   * @returns {Promise<string>} Public IP address
   */
  async getPublicIPAddress() {
    try {
      const response = await fetch("https://api.ipify.org?format=json");
      const data = await response.json();
      return data.ip;
    } catch (error) {
      console.error("Error getting public IP address:", error);
      return this.getIPAddress();
    }
  }

  /**
   * Get user location based on IP address
   * @returns {Promise<string>} User location
   */
  async getUserLocation() {
    try {
      const response = await fetch("http://ip-api.com/json/");
      const locationData = await response.json();

      if (locationData.status === "success") {
        const location = `${locationData.city}, ${locationData.country}`;
        console.log("Detected user location:", location);
        return location;
      }

      if (locationData.country) {
        console.log("Detected country:", locationData.country);
        return locationData.country;
      }
    } catch (error) {
      console.error("Error getting location from IP:", error);
    }

    return await this.getFallbackLocation();
  }

  /**
   * Get fallback location using alternative methods
   * @returns {Promise<string>} Fallback location
   */
  async getFallbackLocation() {
    try {
      const response = await fetch("https://ipapi.co/json/");
      const data = await response.json();

      if (data.city && data.country_name) {
        const location = `${data.city}, ${data.country_name}`;
        console.log("Fallback location detected:", location);
        return location;
      }

      if (data.country_name) {
        console.log("Fallback country detected:", data.country_name);
        return data.country_name;
      }
    } catch (error) {
      console.error("Error with fallback location service:", error);
    }

    return this.getLocationFromTimezone();
  }

  /**
   * Get approximate location from timezone
   * @returns {string} Location based on timezone
   */
  getLocationFromTimezone() {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      console.log("Detected timezone:", timezone);

      const timezoneToLocation = {
        "Asia/Kolkata": "India",
        "Asia/Mumbai": "India",
        "Asia/Delhi": "India",
        "America/New_York": "United States",
        "America/Los_Angeles": "United States",
        "America/Chicago": "United States",
        "Europe/London": "United Kingdom",
        "Europe/Paris": "France",
        "Europe/Berlin": "Germany",
        "Asia/Tokyo": "Japan",
        "Asia/Shanghai": "China",
        "Australia/Sydney": "Australia",
      };

      const location = timezoneToLocation[timezone] || "Unknown";
      console.log("Location from timezone:", location);
      return location;
    } catch (error) {
      console.error("Error getting timezone location:", error);
      return "Unknown";
    }
  }

  /**
   * Get system information with public IP for LMS (FIXED VERSION)
   * @returns {Promise<object>} System info object with public IP
   */
  async getSystemInfoWithPublicIP() {
    try {
      const publicIP = await this.getPublicIPAddress();
      const userLocation = await this.getUserLocation();
      const operatingSystem = this.getOperatingSystem();

      const systemInfo = {
        username: this.getUserEmail(),
        machineNumber: this.getMachineId(),
        userLocation: userLocation,
        operatingSystem: operatingSystem,
        ipAddress: publicIP,
        appName: this.config.appName,
        enableLoginPage: false,
      };

      console.log("Generated system info:", systemInfo);
      return systemInfo;
    } catch (error) {
      console.error("Error generating system info:", error);
      // Return fallback system info
      return {
        username: this.getUserEmail(),
        machineNumber: this.getMachineId(),
        userLocation: "India", // Fallback
        operatingSystem: "Mac", // Fallback
        ipAddress: this.getIPAddress(),
        appName: this.config.appName,
        enableLoginPage: false,
      };
    }
  }

  // JWT methods (keep existing)
  decodeJWT(token) {
    try {
      if (!token) {
        console.error("No token provided for decoding");
        return null;
      }

      const parts = token.split(".");
      if (parts.length !== 3) {
        console.error("Invalid JWT format");
        return null;
      }

      const header = JSON.parse(this.base64UrlDecode(parts[0]));
      const payload = JSON.parse(this.base64UrlDecode(parts[1]));

      return {
        header,
        payload,
        signature: parts[2],
      };
    } catch (error) {
      console.error("Error decoding JWT:", error);
      return null;
    }
  }

  base64UrlDecode(str) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }
    return Buffer.from(base64, "base64").toString("utf8");
  }

  isJWTExpired(token) {
    try {
      const decoded = this.decodeJWT(token);
      if (!decoded || !decoded.payload.exp) {
        return true;
      }
      const currentTime = Math.floor(Date.now() / 1000);
      return decoded.payload.exp < currentTime;
    } catch (error) {
      console.error("Error checking JWT expiration:", error);
      return true;
    }
  }

  getJWTInfo(token = null) {
    const jwtToken = token || this.jwtToken;
    if (!jwtToken) {
      console.error("No JWT token available");
      return null;
    }

    const decoded = this.decodeJWT(jwtToken);
    if (!decoded) {
      return null;
    }

    const isExpired = this.isJWTExpired(jwtToken);
    const expirationDate = decoded.payload.exp
      ? new Date(decoded.payload.exp * 1000)
      : null;
    const issuedDate = decoded.payload.iat
      ? new Date(decoded.payload.iat * 1000)
      : null;

    return {
      header: decoded.header,
      payload: decoded.payload,
      isExpired,
      expirationDate,
      issuedDate,
      username: decoded.payload.username || decoded.payload.body?.username,
      algorithm: decoded.header.alg,
    };
  }

  displayJWTInfo(token = null) {
    const info = this.getJWTInfo(token);
    if (!info) {
      console.log("No valid JWT token information available");
      return;
    }

    console.log("\n=== JWT TOKEN INFORMATION ===");
    console.log("Algorithm:", info.algorithm);
    console.log("Username:", info.username);
    console.log("Issued Date:", info.issuedDate?.toLocaleString());
    console.log("Expiration Date:", info.expirationDate?.toLocaleString());
    console.log("Is Expired:", info.isExpired);
    console.log("\n--- Header ---");
    console.log(JSON.stringify(info.header, null, 2));
    console.log("\n--- Payload ---");
    console.log(JSON.stringify(info.payload, null, 2));
    console.log("\n=============================\n");
  }

  /**
   * Perform SSO login with LMS
   * @param {string} bearerToken - Authorization token
   * @returns {Promise<object|null>} Response data or null on failure
   */
  async performSSOLogin(bearerToken) {
    try {
      const systemInfo = await this.getSystemInfoWithPublicIP();

      console.log("Attempting LMS SSO login for:", systemInfo.username);
      console.log("Dynamic system info:", systemInfo);

      const response = await fetch(this.config.apiUrl, {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify(systemInfo),
      });

      console.log("LMS SSO response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("LMS SSO error response:", errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      console.log("LMS SSO login successful - Response data:", data);

      if (data.jwt) {
        this.jwtToken = data.jwt;
        console.log("JWT token received and stored");
        this.displayJWTInfo(data.jwt);
      }

      return data;
    } catch (error) {
      console.error("LMS SSO login failed:", error);
      return null;
    }
  }

  getJWTToken() {
    return this.jwtToken || null;
  }

  hasGroupAccess() {
    return this.lastResponse?.hasGroupAccess || false;
  }
}

module.exports = LMSIntegration;
