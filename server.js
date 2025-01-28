require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors({
    origin: ['https://fitnessharleyquinn.netlify.app'],
    methods: ['GET', 'POST'],
    credentials: true
}));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Route all HTML requests to the appropriate files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/:page', (req, res) => {
    const page = req.params.page;
    res.sendFile(path.join(__dirname, 'public', page));
});

// Create a payment intent
app.post('/create-payment-intent', async (req, res) => {
    try {
        console.log('Received payment request:', req.body);
        const { programName, programPrice } = req.body;
        
        // Create customer
        const customer = await stripe.customers.create({
            email: req.body.email,
            name: req.body.name,
            metadata: {
                programName: programName
            }
        });

        console.log('Customer created:', customer.id);

        // Create price if it doesn't exist
        const price = await stripe.prices.create({
            unit_amount: parseFloat(programPrice) * 100, // Convert to cents
            currency: 'usd',
            recurring: {
                interval: 'month'
            },
            product_data: {
                name: programName
            }
        });

        console.log('Price created:', price.id);

        // Create a subscription
        const subscription = await stripe.subscriptions.create({
            customer: customer.id,
            items: [{
                price: price.id
            }],
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription' },
            expand: ['latest_invoice.payment_intent']
        });

        console.log('Subscription created:', subscription.id);

        res.json({
            subscriptionId: subscription.id,
            clientSecret: subscription.latest_invoice.payment_intent.client_secret,
        });
    } catch (error) {
        console.error('Error in payment intent creation:', error);
        res.status(500).json({ 
            error: {
                message: error.message,
                type: error.type
            }
        });
    }
});

// Handle webhook events from Stripe
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook Error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle specific events
    switch (event.type) {
        case 'customer.subscription.created':
            const subscription = event.data.object;
            console.log('New subscription created:', subscription.id);
            break;
            
        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            console.log('Payment succeeded for invoice:', invoice.id);
            break;
            
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            console.log('Payment succeeded:', paymentIntent.id);
            break;
            
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({received: true});
});

// Helper function to get Stripe price ID based on program name
function getPriceIdForProgram(programName) {
    const priceIds = {
        'strength': 'price_id_for_strength',
        'complete': 'price_id_for_complete',
        'group': 'price_id_for_group'
    };
    return priceIds[programName];
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: {
            message: 'Internal server error',
            details: err.message
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Server directory: ${__dirname}`);
}); 