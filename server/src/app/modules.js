import { Router } from 'express';
import { createApiRouter } from './routes.js';
import { createUsersService } from '../modules/users/users.service.js';
import { usersRepository } from '../modules/users/users.repository.js';
import { createUsersRouter, createStaffUsersRouter } from '../modules/users/users.routes.js';
import { createStaffUsersService } from '../modules/users/users.staff.service.js';
import { createAuthService } from '../modules/auth/auth.service.js';
import { authRepository } from '../modules/auth/auth.repository.js';
import { createAuthRouter, createAdminAuthRouter } from '../modules/auth/auth.routes.js';
import { createAuthenticate } from '../modules/auth/auth.middleware.js';
import { createEmailSender } from '../shared/infrastructure/email/email.js';
import { runTransaction } from '../shared/utils/transaction.js';
import { categoriesRepository } from '../modules/categories/categories.repository.js';
import { createCategoriesService } from '../modules/categories/categories.service.js';
import { createCategoriesRouter, createStaffCategoriesRouter } from '../modules/categories/categories.routes.js';
import { productsRepository } from '../modules/products/products.repository.js';
import { createProductsService } from '../modules/products/products.service.js';
import { createProductsRouter, createStaffProductsRouter } from '../modules/products/products.routes.js';
import { mediaRepository } from '../modules/media/media.repository.js';
import { createMediaService } from '../modules/media/media.service.js';
import { createMediaRouter } from '../modules/media/media.routes.js';
import { createBunnyStorage } from '../shared/infrastructure/media/bunny.js';
import { shippingRepository } from '../modules/shipping/shipping.repository.js';
import { createShippingService } from '../modules/shipping/shipping.service.js';
import { createShippingRouter, createStaffShippingRouter } from '../modules/shipping/shipping.routes.js';
import { cartRepository } from '../modules/cart/cart.repository.js';
import { createCartService } from '../modules/cart/cart.service.js';
import { createCartRouter } from '../modules/cart/cart.routes.js';
import { salesRepository } from '../modules/sales/sales.repository.js';
import { createSalesService } from '../modules/sales/sales.service.js';
import { createStaffSalesRouter } from '../modules/sales/sales.routes.js';
import { couponsRepository } from '../modules/coupons/coupons.repository.js';
import { createCouponsService } from '../modules/coupons/coupons.service.js';
import { createStaffCouponsRouter, createCouponPreviewRouter } from '../modules/coupons/coupons.routes.js';
import { ordersRepository } from '../modules/orders/orders.repository.js';
import { createOrdersService } from '../modules/orders/orders.service.js';
import { createCheckoutRouter, createOrdersRouter, createStaffOrdersRouter } from '../modules/orders/orders.routes.js';
import { createBunnyProofStorage } from '../shared/infrastructure/media/bunny-proof.js';
import { wishlistRepository } from '../modules/wishlist/wishlist.repository.js';
import { createWishlistService } from '../modules/wishlist/wishlist.service.js';
import { createWishlistRouter } from '../modules/wishlist/wishlist.routes.js';
import { formsRepository } from '../modules/forms/forms.repository.js';
import { createFormsService } from '../modules/forms/forms.service.js';
import { createFormsRouter, createStaffFormsRouter } from '../modules/forms/forms.routes.js';
import { wholesaleRepository } from '../modules/wholesale/wholesale.repository.js';
import { createWholesaleService } from '../modules/wholesale/wholesale.service.js';
import { createWholesaleRouter, createStaffWholesaleRouter } from '../modules/wholesale/wholesale.routes.js';
import { leadsRepository } from '../modules/leads/leads.repository.js';
import { createLeadsService } from '../modules/leads/leads.service.js';
import { createLeadsRouter, createStaffLeadsRouter } from '../modules/leads/leads.routes.js';
import { createBunnyLeadStorage } from '../shared/infrastructure/media/bunny-leads.js';
import { emailDeliveryRepository } from '../shared/infrastructure/email/delivery.repository.js';
import { createEmailDelivery } from '../shared/infrastructure/email/delivery.js';
import { notificationsRepository } from '../modules/notifications/notifications.repository.js';
import { createNotificationsService } from '../modules/notifications/notifications.service.js';
import { createStaffNotificationsRouter } from '../modules/notifications/notifications.routes.js';
import { sizechartsRepository } from '../modules/sizecharts/sizecharts.repository.js';
import { createSizechartsService } from '../modules/sizecharts/sizecharts.service.js';
import { createStaffSizechartsRouter } from '../modules/sizecharts/sizecharts.routes.js';
import { sitesettingsRepository } from '../modules/sitesettings/sitesettings.repository.js';
import { createSitesettingsService } from '../modules/sitesettings/sitesettings.service.js';
import { createSitesettingsRouter, createStaffSitesettingsRouter } from '../modules/sitesettings/sitesettings.routes.js';
import { homepageRepository } from '../modules/homepage/homepage.repository.js';
import { createHomepageService } from '../modules/homepage/homepage.service.js';
import { createHomepageRouter, createStaffHomepageRouter } from '../modules/homepage/homepage.routes.js';
import { homepageSlots, homepageTargetId } from '../modules/homepage/homepage.slots.js';
import { createReportsService } from '../modules/reports/reports.service.js';
import { reportsRepository } from '../modules/reports/reports.repository.js';
import { createStaffReportsRouter } from '../modules/reports/reports.routes.js';

export const initializeModules = () => Promise.all([usersRepository.initialize(), authRepository.initialize(), categoriesRepository.initialize(), productsRepository.initialize(), mediaRepository.initialize(), shippingRepository.initialize(), cartRepository.initialize(), salesRepository.initialize(), couponsRepository.initialize(), ordersRepository.initialize(), wishlistRepository.initialize(), formsRepository.initialize(), wholesaleRepository.initialize(), leadsRepository.initialize(), emailDeliveryRepository.initialize(), notificationsRepository.initialize(), sizechartsRepository.initialize(), sitesettingsRepository.initialize(), homepageRepository.initialize()]);

export function createBusinessRouter(config, {
  users = createUsersService(), email = createEmailSender(config), repository = authRepository,
  userRepository = usersRepository, transaction = runTransaction, categoryRepository = categoriesRepository,
  productRepository = productsRepository, imageRepository = mediaRepository, storage = createBunnyStorage(config.bunnyPublic),
  deliveryRepository = shippingRepository,
  shoppingRepository = cartRepository,
  campaignRepository = salesRepository,
  discountRepository = couponsRepository,
  orderRepository = ordersRepository, proofStorage = createBunnyProofStorage(config.bunnyProof),
  favoritesRepository = wishlistRepository,
  definitionRepository = formsRepository,
  offerRepository = wholesaleRepository,
  submissionRepository = leadsRepository, leadStorage = createBunnyLeadStorage(config.bunnyProof),
  notificationRepository = emailDeliveryRepository,
  staffNotificationRepository = notificationsRepository,
  chartRepository = sizechartsRepository,
  siteRepository = sitesettingsRepository,
  homeRepository = homepageRepository,
  reportRepository = reportsRepository,
} = {}) {
  const auth = createAuthService(config, { users, email, repository, transaction });
  const staff = createStaffUsersService({ auth, repository: userRepository, transaction });
  const authenticate = createAuthenticate(auth);
  const shipping = createShippingService({ auth, repository: deliveryRepository, transaction });
  const forms = createFormsService({ auth, repository: definitionRepository, transaction });
  const siteSettings = createSitesettingsService({ auth, repository: siteRepository, transaction });
  let products;
  let categories;
  let cart;
  let sales;
  let coupons;
  let orders;
  let wishlist;
  let wholesale;
  let leads;
  let sizecharts;
  let homepage;
  const customerEmails = createEmailDelivery({ config, email, repository: notificationRepository });
  const staffNotifications = createNotificationsService({ auth, repository: staffNotificationRepository });
  const notifications = { async enqueue(data, session) {
    await staffNotifications.enqueue(data, session);
    await customerEmails.enqueue(data, session);
  } };
  const campaigns = {
    validateCatalog: (...args) => sales.validateCatalog(...args),
    applyPrices: (...args) => sales.applyPrices(...args),
    hasCategoryReferences: (...args) => sales.hasCategoryReferences(...args),
  };
  const media = createMediaService({ auth, repository: imageRepository, storage, targets: {
    product: { getStaff: (store, ...args) => store === 'b2b' ? wholesale.getProduct(store, ...args) : products.getStaff(store, ...args) },
    category: { getStaff: (...args) => categories.getStaff(...args) },
    'size-chart-en': { getStaff: (...args) => sizecharts.getStaff(...args) },
    'size-chart-ar': { getStaff: (...args) => sizecharts.getStaff(...args) },
    ...Object.fromEntries(['desktop', 'mobile'].map(device => [`homepage-${device}`, {
      async getStaff(store, identity, targetId) {
        const slot = homepageSlots(store).find(slot => homepageTargetId(store, slot.key) === targetId);
        if (!slot) throw new Error('Invalid homepage media target.');
        await homepage.authorizeImage(store, identity, slot.key);
      },
    }])),
  } });
  categories = createCategoriesService({ auth, repository: categoryRepository, transaction, media, sales: campaigns,
    coupons: { hasCategoryReferences: (...args) => coupons.hasCategoryReferences(...args) },
    products: { hasAssignedCategory: (...args) => products.hasAssignedCategory(...args) } });
  products = createProductsService({ auth, categories, repository: productRepository, transaction, media, sales: campaigns,
    sizeCharts: { validateAssignment: (...args) => sizecharts.validateAssignment(...args),
      publicForProducts: (...args) => sizecharts.publicForProducts(...args) },
    references: { async hasProductReferences(store, productId, variantIds, session) {
      return await cart.hasProductReferences(store, productId, variantIds, session)
        || await orders.hasProductReferences(store, productId, variantIds, session)
        || await wholesale.hasB2cReferences(productId, variantIds, session)
        || (!variantIds && await wishlist.hasProductReferences(store, productId, session))
        || (!variantIds && Boolean(await sales.hasProductReferences(store, productId, session)))
        || (!variantIds && Boolean(await coupons.hasProductReferences(store, productId, session)))
        || (!variantIds && await homepage.hasProductReferences(productId, session));
    } } });
  sizecharts = createSizechartsService({ auth, categories, products, media, repository: chartRepository, transaction });
  homepage = createHomepageService({ auth, products, media, repository: homeRepository, transaction });
  cart = createCartService({ auth, products, repository: shoppingRepository, transaction });
  wholesale = createWholesaleService({ auth, products, media, repository: offerRepository, transaction,
    references: { hasOfferReferences: (...args) => leads.hasOfferReferences(...args) } });
  leads = createLeadsService({ auth, forms, wholesale, storage: leadStorage, trackingSecret: config.jwtSecret, repository: submissionRepository, transaction, notifications });
  wishlist = createWishlistService({ auth, products, repository: favoritesRepository, transaction });
  sales = createSalesService({ auth, categories, products, repository: campaignRepository, transaction });
  coupons = createCouponsService({ auth, categories, products, cart, identitySecret: config.couponIdentitySecret, repository: discountRepository, transaction });
  orders = createOrdersService({ auth,cart,products,coupons,shipping,storage:proofStorage,
    trackingSecret:config.jwtSecret,repository:orderRepository,transaction,notifications });
  const reports = createReportsService({ auth, products, repository: reportRepository });
  const routers = {};
  for (const store of ['b2c', 'b2b']) {
    const router = Router();
    router.use('/auth', createAuthRouter(auth, authenticate, config));
    router.use('/users', createUsersRouter(users, authenticate));
    router.use('/site-settings', createSitesettingsRouter(siteSettings));
    router.use('/homepage', createHomepageRouter(homepage));
    routers[store] = router;
    const dashboard = Router();
    dashboard.use('/notifications', createStaffNotificationsRouter(staffNotifications, authenticate));
    dashboard.use('/users', createStaffUsersRouter(users, staff, authenticate));
    dashboard.use('/auth', createAdminAuthRouter(auth, authenticate, config));
    dashboard.use('/site-settings', createStaffSitesettingsRouter(siteSettings, authenticate));
    dashboard.use('/homepage', createStaffHomepageRouter(homepage, authenticate));
    if (store === 'b2c') {
      router.use('/categories', createCategoriesRouter(categories));
      dashboard.use('/categories', createStaffCategoriesRouter(categories, authenticate));
      router.use('/products', createProductsRouter(products));
      dashboard.use('/products', createStaffProductsRouter(products, authenticate));
      dashboard.use('/size-charts', createStaffSizechartsRouter(sizecharts, authenticate));
      dashboard.use('/media', createMediaRouter(media, authenticate));
      router.use('/shipping-fees', createShippingRouter(shipping));
      router.use('/cart', createCartRouter(cart, authenticate, config, createCouponPreviewRouter(coupons),createCheckoutRouter(orders)));
      router.use('/orders',createOrdersRouter(orders,authenticate));
      router.use('/wishlist', createWishlistRouter(wishlist, authenticate));
      dashboard.use('/orders',createStaffOrdersRouter(orders,authenticate));
      dashboard.use('/reports',createStaffReportsRouter(reports,authenticate));
      dashboard.use('/shipping-fees', createStaffShippingRouter(shipping, authenticate));
      dashboard.use('/sales', createStaffSalesRouter(sales, authenticate));
      dashboard.use('/coupons', createStaffCouponsRouter(coupons, authenticate));
    }
    if (store === 'b2b') {
      router.use('/forms', createFormsRouter(forms));
      dashboard.use('/forms', createStaffFormsRouter(forms, authenticate));
      router.use('/wholesale', createWholesaleRouter(wholesale));
      dashboard.use('/wholesale', createStaffWholesaleRouter(wholesale, authenticate));
      dashboard.use('/media', createMediaRouter(media, authenticate));
      router.use('/leads', createLeadsRouter(leads, authenticate));
      dashboard.use('/leads', createStaffLeadsRouter(leads, authenticate));
    }
    routers[store === 'b2c' ? 'adminB2c' : 'adminB2b'] = dashboard;
  }
  return createApiRouter(routers);
}
