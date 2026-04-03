import pandas as pd
import numpy as np
import random

# Configuration
num_rows = 75000  # Adjust this to hit your ~10MB target
categories = ['Electronics', 'Furniture', 'Clothing', 'Groceries', 'Toys']
regions = ['North', 'South', 'East', 'West', 'Central']
status = ['In Stock', 'Out of Stock', 'Backordered']

data = {
    'Product_ID': [f"PROD-{i:06d}" for i in range(num_rows)],
    'Product_Name': [f"Item_{random.randint(100, 999)}" for _ in range(num_rows)],
    'Category': [random.choice(categories) for _ in range(num_rows)],
    'Region': [random.choice(regions) for _ in range(num_rows)],
    'Price': np.round(np.random.uniform(10.0, 500.0, num_rows), 2),
    'Stock_Level': np.random.randint(0, 1000, num_rows),
    'Status': [random.choice(status) for _ in range(num_rows)],
    'Last_Updated': pd.date_range(start='2024-01-01', periods=num_rows, freq='min').strftime('%Y-%m-%d %H:%M')
}

df = pd.DataFrame(data)

# Save as CSV
df.to_csv('large_inventory_data.csv', index=False)
print(f"CSV generated: {num_rows} rows.")

# Save as Excel (Note: Writing 75k rows to Excel takes a bit longer than CSV)
df.to_excel('large_inventory_data.xlsx', index=False)
print("Excel generated.")