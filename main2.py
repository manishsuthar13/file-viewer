import pandas as pd
import numpy as np
import random

# Configuration
num_rows = 75000

# Skewed distributions
categories = ['Electronics', 'Furniture', 'Clothing', 'Groceries', 'Toys']
category_weights = [0.35, 0.15, 0.25, 0.15, 0.10]

regions = ['North', 'South', 'East', 'West', 'Central']
region_weights = [0.30, 0.20, 0.15, 0.25, 0.10]

status_list = ['In Stock', 'Out of Stock', 'Backordered']

# Popular products (appear more often)
popular_items = [f"Item_{i}" for i in range(100, 120)]
all_items = [f"Item_{i}" for i in range(100, 999)]

data = []

for i in range(num_rows):
    category = random.choices(categories, weights=category_weights)[0]
    region = random.choices(regions, weights=region_weights)[0]

    # Product skew (popular items more frequent)
    if random.random() < 0.6:
        product_name = random.choice(popular_items)
    else:
        product_name = random.choice(all_items)

    # Price skew (log-normal → more low-mid values, few expensive)
    price = round(np.random.lognormal(mean=3.5, sigma=0.5), 2)

    # Category-based stock logic
    if category == 'Electronics':
        stock = np.random.randint(0, 300)
    elif category == 'Groceries':
        stock = np.random.randint(200, 1000)
    else:
        stock = np.random.randint(50, 600)

    # Status logic based on stock
    if stock == 0:
        status = 'Out of Stock'
    elif stock < 50:
        status = 'Backordered'
    else:
        status = 'In Stock'

    # Randomized timestamps (not perfectly sequential)
    random_minutes = random.randint(0, 60*24*90)  # within ~3 months
    last_updated = pd.Timestamp('2024-01-01') + pd.Timedelta(minutes=random_minutes)

    data.append([
        f"PROD-{i:06d}",
        product_name,
        category,
        region,
        price,
        stock,
        status,
        last_updated.strftime('%Y-%m-%d %H:%M')
    ])

df = pd.DataFrame(data, columns=[
    'Product_ID', 'Product_Name', 'Category',
    'Region', 'Price', 'Stock_Level',
    'Status', 'Last_Updated'
])

# Save files
df.to_csv('large_inventory_data_skewed.csv', index=False)
print(f"CSV generated: {num_rows} rows.")

df.to_excel('large_inventory_data_skewed.xlsx', index=False)
print("Excel generated.")